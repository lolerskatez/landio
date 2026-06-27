const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sendNotification } = require('./notifications');
const db = require('../lib/datalayer');

// Get all users (admin only)
// Supports pagination via ?page=1&limit=50 and search via ?search=term
// When pagination params are provided, returns { users, pagination }
// Without pagination params, returns array (backward-compatible)
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const page = parseInt(req.query.page);
  const limit = parseInt(req.query.limit);
  const search = req.query.search || '';
  const hasPagination = !isNaN(page) || !isNaN(limit);

  const effectiveLimit = hasPagination ? Math.min(200, Math.max(1, limit || 50)) : 9999;
  const effectivePage = hasPagination ? Math.max(1, page || 1) : 1;
  const offset = (effectivePage - 1) * effectiveLimit;

  let whereClause = '';
  const countParams = [];
  const queryParams = [];

  if (search) {
    whereClause = 'WHERE (u.name LIKE ? OR u.email LIKE ?)';
    const searchPattern = `%${search}%`;
    countParams.push(searchPattern, searchPattern);
    queryParams.push(searchPattern, searchPattern);
  }

  queryParams.push(effectiveLimit, offset);

  // Get total count
  global.db.get(
    `SELECT COUNT(*) as count FROM users u ${whereClause}`,
    countParams,
    (err, countRow) => {
      if (err) {
        console.error('Database error counting users:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      const total = countRow ? countRow.count : 0;
      const totalPages = Math.ceil(total / effectiveLimit) || 1;

      const query = `
        SELECT u.id, u.username, u.name, u.display_name, u.email, u.role, u.avatar, u.groups, u.permissions,
               u.last_login, u.created_at, u.updated_at, u.is_active,
               u.login_count, u.last_activity, u.sso_provider,
               (SELECT value FROM settings WHERE user_id = u.id AND key = 'two_factor_enabled' LIMIT 1) as twoFactorEnabled
        FROM users u
        ${whereClause}
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?
      `;

      global.db.all(query, queryParams, (err, rows) => {
        if (err) {
          console.error('Database error in users GET /:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        // Parse JSON fields for each user
        const users = rows.map(user => {
          try {
            return {
              ...user,
              groups: JSON.parse(user.groups || '[]'),
              permissions: JSON.parse(user.permissions || '{}'),
              twoFactorEnabled: user.twoFactorEnabled === 'true'
            };
          } catch (e) {
            console.warn('Error parsing user data:', e);
            return {
              ...user,
              groups: [],
              permissions: {},
              twoFactorEnabled: false
            };
          }
        });

        if (hasPagination) {
          res.json({
            users,
            pagination: {
              page: effectivePage,
              limit: effectiveLimit,
              total,
              totalPages
            }
          });
        } else {
          res.json(users);
        }
      });
    }
  );
});

// Get user by ID
router.get('/:id', authenticateToken, (req, res) => {
  const userId = req.params.id;

  // Users can view their own profile, admins can view any
  if (req.user.role !== 'admin' && req.user.id != userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const query = `
    SELECT id, username, name, display_name, email, role, avatar, groups, permissions,
           last_login, created_at, updated_at, is_active,
           login_count, last_activity, sso_provider
    FROM users WHERE id = ?
  `;

  global.db.get(query, [userId], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Parse JSON fields
    try {
      user.groups = JSON.parse(user.groups || '[]');
      user.permissions = JSON.parse(user.permissions || '{}');
    } catch (e) {
      user.groups = [];
      user.permissions = {};
    }

    res.json(user);
  });
});

// Get user's 2FA status (users can check their own, admins can check anyone)
router.get('/:id/2fa-status', authenticateToken, (req, res) => {
  const userId = req.params.id;

  // Users can view their own 2FA status, admins can view any
  if (req.user.role !== 'admin' && req.user.id != userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  global.db.all(
    `SELECT key, value FROM settings
     WHERE user_id = ? AND key IN ('two_factor_enabled', 'two_factor_secret', 'two_factor_backup_codes')`,
    [userId],
    (err, settings) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      let twoFactorEnabled = false;
      let backupCodes = [];

      if (settings) {
        settings.forEach(setting => {
          if (setting.key === 'two_factor_enabled') {
            twoFactorEnabled = setting.value === 'true';
          } else if (setting.key === 'two_factor_backup_codes') {
            try {
              backupCodes = JSON.parse(setting.value);
            } catch (e) {
              backupCodes = [];
            }
          }
        });
      }

      res.json({
        twoFactorEnabled: twoFactorEnabled,
        backupCodes: backupCodes
      });
    }
  );
});

// Create new user (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, name, displayName, email, password, role, groups, permissions } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if user already exists
    global.db.get('SELECT id FROM users WHERE email = ?', [email], async (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (existingUser) {
        return res.status(409).json({ error: 'User with this email already exists' });
      }

      // Generate username if not provided
      let finalUsername = username || email.split('@')[0];

      // Check username is unique
      global.db.get('SELECT id FROM users WHERE username = ?', [finalUsername], async (err, userWithUsername) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (userWithUsername) {
          return res.status(409).json({ error: 'Username already exists' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Prepare user data
        const userData = {
          username: finalUsername,
          name,
          display_name: displayName || name,
          email,
          password_hash: passwordHash,
          role: role || 'user',
          avatar: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          groups: JSON.stringify(groups || ['users']),
          permissions: JSON.stringify(permissions || {
            canViewServices: true,
            canManageOwnServices: false,
            canViewPerformance: true,
            canManageUsers: false,
            canAccessSettings: false,
            canViewLogs: false,
            canManageSystem: false
          })
        };

        // Insert user
        const query = `
          INSERT INTO users (username, name, display_name, email, password_hash, role, avatar, groups, permissions)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        global.db.run(query, [
          userData.username,
          userData.name,
          userData.display_name,
          userData.email,
          userData.password_hash,
          userData.role,
          userData.avatar,
          userData.groups,
          userData.permissions
        ], function(err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to create user' });
          }

          const newUserId = this.lastID;

          // Log activity via datalayer
          db.activityLog.create(req.user.id, 'create_user', `Created user: ${name} (${email})`, req.ip, req.get('User-Agent'))
            .catch(err => console.error('Error writing audit log:', err));

          // Return created user (without password)
          global.db.get('SELECT id, username, name, display_name, email, role, avatar, groups, permissions, created_at FROM users WHERE id = ?',
            [newUserId], (err, user) => {
              if (err) {
                return res.status(500).json({ error: 'User created but failed to retrieve' });
              }

              try {
                user.groups = JSON.parse(user.groups || '[]');
                user.permissions = JSON.parse(user.permissions || '{}');
              } catch (e) {
                user.groups = [];
                user.permissions = {};
              }

              // Send user-activity notification
              sendNotification('user-activity', {
                username: req.user.name,
                activity: `Created new user: ${name} (${email}) with role ${role}`,
                performedBy: req.user.email
              }).catch(err => console.error('User-activity notification error:', err));

              res.status(201).json(user);
            });
        });
      });
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const updates = req.body;

    // Users can update their own profile, admins can update any
    if (req.user.role !== 'admin' && req.user.id != userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if user exists
    global.db.get('SELECT * FROM users WHERE id = ?', [userId], async (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Prepare update data
      const updateData = {};
      const updateFields = [];
      const updateValues = [];

      // Handle password update
      if (updates.password) {
        // Validate password policy
        const getSecuritySetting = (key, defaultValue, callback) => {
          global.db.get(
            'SELECT value FROM settings WHERE key = ? AND user_id IS NULL',
            [key],
            (err, row) => {
              if (err) {
                console.error(`Error getting security setting ${key}:`, err);
                return callback(defaultValue);
              }
              const value = row ? row.value : defaultValue;
              
              if (value === 'true') return callback(true);
              if (value === 'false') return callback(false);
              if (!isNaN(value) && value !== '') return callback(Number(value));
              
              callback(value);
            }
          );
        };

        // Check if password policy is enabled
        let passwordPolicyFailed = false;
        await new Promise((resolve) => {
          getSecuritySetting('password-policy', true, (policyEnabled) => {
            if (!policyEnabled) {
              resolve();
              return;
            }

            const issues = [];
            
            if (updates.password.length < 8) issues.push('Password must be at least 8 characters');
            if (!/[A-Z]/.test(updates.password)) issues.push('Must contain uppercase letters');
            if (!/[a-z]/.test(updates.password)) issues.push('Must contain lowercase letters');
            if (!/[0-9]/.test(updates.password)) issues.push('Must contain numbers');
            if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(updates.password)) issues.push('Must contain special characters');

            if (issues.length > 0) {
              passwordPolicyFailed = true;
              resolve();
              return;
            }

            resolve();
          });
        });

        if (passwordPolicyFailed) {
          return res.status(400).json({ error: 'Password policy validation failed' });
        }

        updateData.password_hash = await bcrypt.hash(updates.password, 10);
        updateFields.push('password_hash = ?');
        updateValues.push(updateData.password_hash);
      }

      // Handle other fields
      ['username', 'name', 'display_name', 'email', 'role', 'avatar', 'is_active'].forEach(field => {
        if (updates[field] !== undefined) {
          updateData[field] = updates[field];
          updateFields.push(`${field} = ?`);
          updateValues.push(updates[field]);
        }
      });

      // Handle JSON fields
      if (updates.groups !== undefined) {
        updateData.groups = JSON.stringify(updates.groups);
        updateFields.push('groups = ?');
        updateValues.push(updateData.groups);
      }

      if (updates.permissions !== undefined) {
        updateData.permissions = JSON.stringify(updates.permissions);
        updateFields.push('permissions = ?');
        updateValues.push(updateData.permissions);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      // Add updated_at timestamp
      updateFields.push('updated_at = CURRENT_TIMESTAMP');

      // Execute update
      const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
      updateValues.push(userId);

      global.db.run(query, updateValues, function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to update user' });
        }

        // Log activity via datalayer
        db.activityLog.create(req.user.id, 'update_user', `Updated user ID: ${userId}`, req.ip, req.get('User-Agent'))
          .catch(err => console.error('Error writing audit log:', err));

        // Return updated user
        global.db.get(`
          SELECT id, name, email, role, avatar, groups, permissions,
                 last_login, created_at, updated_at, is_active,
                 login_count, last_activity
          FROM users WHERE id = ?
        `, [userId], (err, user) => {
          if (err) {
            return res.status(500).json({ error: 'User updated but failed to retrieve' });
          }

          try {
            user.groups = JSON.parse(user.groups || '[]');
            user.permissions = JSON.parse(user.permissions || '{}');
          } catch (e) {
            user.groups = [];
            user.permissions = {};
          }

          res.json(user);
        });
      });
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (admin only)
// Includes "last admin" guard — prevents deleting the only admin account
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const userId = req.params.id;

  // Prevent deleting self
  if (req.user.id == userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  // Check if user exists and get their role
  global.db.get('SELECT name, email, role FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Last admin guard: if target user is an admin, check they aren't the last one
    if (user.role === 'admin') {
      global.db.get('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin'], (err, row) => {
        if (err) {
          console.error('Database error counting admins:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (row.count <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last admin account' });
        }

        // Proceed with delete
        deleteUser(user, req, res);
      });
    } else {
      // Not an admin, proceed directly
      deleteUser(user, req, res);
    }
  });
});

// Helper: delete user and log activity
function deleteUser(user, req, res) {
  const userId = req.params.id;

  global.db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Failed to delete user' });
    }

    // Log activity via datalayer
    db.activityLog.create(req.user.id, 'delete_user', `Deleted user: ${user.name} (${user.email})`, req.ip, req.get('User-Agent'))
      .catch(err => console.error('Error writing audit log:', err));

    // Send user-activity notification
    sendNotification('user-activity', {
      username: req.user.name,
      activity: `Deleted user: ${user.name} (${user.email})`,
      performedBy: req.user.email
    }).catch(err => console.error('User-activity notification error:', err));
    
    res.json({ message: 'User deleted successfully' });
  });
}

// Get user activity log (admin only)
router.get('/:id/activity', authenticateToken, requireAdmin, (req, res) => {
  const userId = req.params.id;
  const limit = parseInt(req.query.limit) || 50;

  global.db.all(
    'SELECT * FROM activity_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?',
    [userId, limit],
    (err, activities) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      res.json(activities);
    }
  );
});

// Check if user has completed onboarding
router.get('/onboarding/status', authenticateToken, (req, res) => {
  console.log('GET /api/users/onboarding/status - User:', req.user.email);

  global.db.get(
    'SELECT onboarding_completed FROM users WHERE id = ?',
    [req.user.id],
    (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!row) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ onboarding_completed: row.onboarding_completed === 1 || row.onboarding_completed === true });
    }
  );
});

// Mark onboarding as completed
router.post('/onboarding/complete', authenticateToken, (req, res) => {
  console.log('POST /api/users/onboarding/complete - User:', req.user.email);

  global.db.run(
    'UPDATE users SET onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [req.user.id],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      console.log('Marked onboarding as completed for user:', req.user.email);
      res.json({ success: true, message: 'Onboarding marked as completed' });
    }
  );
});

module.exports = router;