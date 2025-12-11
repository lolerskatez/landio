const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Get all users (admin only)
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  console.log('GET /api/users - User authenticated:', req.user);
  const query = `
    SELECT u.id, u.name, u.email, u.role, u.avatar, u.groups, u.permissions,
           u.last_login, u.created_at, u.updated_at, u.is_active,
           u.login_count, u.last_activity,
           (SELECT value FROM settings WHERE user_id = u.id AND key = 'twoFactorEnabled' LIMIT 1) as twoFactorEnabled
    FROM users u
    ORDER BY u.created_at DESC
  `;

  global.db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Database error in users GET /:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    console.log('Database returned', rows ? rows.length : 0, 'users');

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

    console.log('Parsed', users.length, 'users successfully');
    res.json(users);
  });
});

// Get user by ID
router.get('/:id', authenticateToken, (req, res) => {
  const userId = req.params.id;

  // Users can view their own profile, admins can view any
  if (req.user.role !== 'admin' && req.user.id != userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const query = `
    SELECT id, name, email, role, avatar, groups, permissions,
           last_login, created_at, updated_at, is_active,
           login_count, last_activity
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
     WHERE user_id = ? AND key IN ('twoFactorEnabled', 'twoFactorSecret', 'twoFactorBackupCodes')`,
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
          if (setting.key === 'twoFactorEnabled') {
            twoFactorEnabled = setting.value === 'true';
          } else if (setting.key === 'twoFactorBackupCodes') {
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
    const { name, email, password, role, groups, permissions } = req.body;

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

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Prepare user data
      const userData = {
        name,
        email,
        password_hash: passwordHash,
        role: role || 'user',
        avatar: name.split(' ').map(n => n[0]).join('').toUpperCase(),
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
        INSERT INTO users (name, email, password_hash, role, avatar, groups, permissions)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      global.db.run(query, [
        userData.name,
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

        // Log activity
        global.db.run(
          'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
          [req.user.id, 'create_user', `Created user: ${name} (${email})`, req.ip, req.get('User-Agent')]
        );

        // Return created user (without password)
        global.db.get('SELECT id, name, email, role, avatar, groups, permissions, created_at FROM users WHERE id = ?',
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
        await new Promise((resolve, reject) => {
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
              return reject(new Error(`Password does not meet policy requirements: ${issues.join(', ')}`));
            }

            resolve();
          });
        }).catch(err => {
          return res.status(400).json({ error: err.message });
        });

        updateData.password_hash = await bcrypt.hash(updates.password, 10);
        updateFields.push('password_hash = ?');
        updateValues.push(updateData.password_hash);
      }

      // Handle other fields
      ['name', 'email', 'role', 'avatar', 'is_active'].forEach(field => {
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

        // Log activity
        global.db.run(
          'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
          [req.user.id, 'update_user', `Updated user ID: ${userId}`, req.ip, req.get('User-Agent')]
        );

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
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const userId = req.params.id;

  // Prevent deleting self
  if (req.user.id == userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  // Check if user exists
  global.db.get('SELECT name, email FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user
    global.db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to delete user' });
      }

      // Log activity
      global.db.run(
        'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, 'delete_user', `Deleted user: ${user.name} (${user.email})`, req.ip, req.get('User-Agent')]
      );

      // Send user-activity notification
      sendNotification('user-activity', {
        username: req.user.name,
        activity: `Deleted user: ${user.name} (${user.email})`,
        performedBy: req.user.email
      }).catch(err => console.error('User-activity notification error:', err));
      
      res.json({ message: 'User deleted successfully' });
    });
  });
});

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

// Reset user's 2FA (admin only)
router.post('/:id/reset-2fa', authenticateToken, requireAdmin, (req, res) => {
  const userId = req.params.id;
  
  console.log('POST /api/users/:id/reset-2fa - Admin:', req.user.email, 'resetting 2FA for user ID:', userId);
  
  // First check if user exists
  global.db.get('SELECT id, name, email FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Delete all 2FA-related settings for this user
    global.db.run(
      `DELETE FROM settings 
       WHERE user_id = ? AND key IN ('twoFactorEnabled', 'twoFactorSecret', 'twoFactorBackupCodes', '2faEnrollmentRequired')`,
      [userId],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to reset 2FA' });
        }
        
        // Log activity
        global.db.run(
          'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
          [req.user.id, 'reset_user_2fa', `Reset 2FA for user: ${user.name} (${user.email})`, req.ip, req.get('User-Agent')]
        );
        
        // Send security notification for 2FA reset
        sendNotification('security', {
          securityEvent: '2FA Reset',
          username: user.name,
          email: user.email,
          performedBy: req.user.email,
          severity: 'High'
        }).catch(err => console.error('Security notification error:', err));
        
        console.log('Successfully reset 2FA for user:', user.email);
        res.json({ 
          success: true, 
          message: `2FA has been reset for ${user.name}`,
          user: {
            id: user.id,
            name: user.name,
            email: user.email
          }
        });
      }
    );
  });
});

module.exports = router;