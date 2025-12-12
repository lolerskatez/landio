const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { sendNotification } = require('./notifications');

// JWT secret - in production, use environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';

// Middleware to verify JWT token (regular or 2FA enrollment)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // CRITICAL: Verify user still exists in database
    // This prevents orphaned tokens from being used after user deletion/redeployment
    global.db.get(
      'SELECT id, email, role, is_active FROM users WHERE id = ?',
      [user.id],
      (err, dbUser) => {
        if (err) {
          console.error('Database error during token validation:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!dbUser) {
          console.warn(`Token validation failed: user ${user.id} not found in database`);
          return res.status(403).json({ error: 'User not found or has been deleted' });
        }

        if (!dbUser.is_active) {
          console.warn(`Token validation failed: user ${user.id} is disabled`);
          return res.status(403).json({ error: 'User account is disabled' });
        }

        // Check IP whitelist if enabled
        global.db.get(
          'SELECT value FROM settings WHERE key = ? AND user_id IS NULL',
          ['ip-whitelist'],
          (err, row) => {
            const ipWhitelistEnabled = row && row.value === 'true';

            if (ipWhitelistEnabled) {
              global.db.get(
                'SELECT value FROM settings WHERE key = ? AND user_id IS NULL',
                ['allowed-ips'],
                (err, ipsRow) => {
                  if (!ipsRow) {
                    // No IPs configured, allow all
                    req.user = user;
                    return next();
                  }

                  const allowedIPs = ipsRow.value.split(',').map(ip => ip.trim());
                  const clientIP = req.ip || req.connection.remoteAddress;

                  // Check if IP matches or is in CIDR range
                  const ipMatches = allowedIPs.some(allowedIP => {
                    // Simple check: exact match or CIDR parsing
                    if (allowedIP.includes('/')) {
                      // CIDR notation - simplified check
                      const [network, bits] = allowedIP.split('/');
                      // For production, use ipaddr.js or similar library
                      return clientIP.includes(network.split('.').slice(0, 3).join('.'));
                    }
                    return clientIP === allowedIP;
                  });

                  if (!ipMatches) {
                    console.warn(`IP whitelist blocked access from ${clientIP}`);
                    return res.status(403).json({ error: 'Access denied: IP not whitelisted' });
                  }

                  req.user = user;
                  next();
                }
              );
            } else {
              req.user = user;
              next();
            }
          }
        );
      }
    );
  });
};

// Middleware for 2FA enrollment (accepts regular tokens or temporary enrollment tokens)
const authenticateFor2FAEnrollment = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Allow both regular authenticated users and temporary 2FA enrollment tokens
    if (user.purpose === '2fa-enrollment' || (user.id && user.email && !user.purpose)) {
      // CRITICAL: Verify user still exists in database for regular tokens
      // Temporary 2FA enrollment tokens may be used during setup before user is fully saved
      if (user.purpose !== '2fa-enrollment') {
        global.db.get(
          'SELECT id, email, role, is_active FROM users WHERE id = ?',
          [user.id],
          (err, dbUser) => {
            if (err || !dbUser) {
              console.warn(`2FA enrollment token validation failed: user ${user.id} not found in database`);
              return res.status(403).json({ error: 'User not found' });
            }

            if (!dbUser.is_active) {
              console.warn(`2FA enrollment rejected: user ${user.id} is disabled`);
              return res.status(403).json({ error: 'User account is disabled' });
            }

            req.user = user;
            return next();
          }
        );
      } else {
        // Temporary 2FA enrollment token - allow without DB check
        req.user = user;
        return next();
      }
    } else {
      return res.status(403).json({ error: 'Invalid token for 2FA enrollment' });
    }
  });
};

// Check if system is initialized (any users exist)
function isSystemInitialized(callback) {
  global.db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
    if (err) {
      console.error('Database error checking initialization:', err);
      callback(false);
    } else {
      callback(row && row.count > 0);
    }
  });
}

// Check if 2FA is required for a user based on enforcement policy
function is2FARequired(user, callback) {
  // First get the enforcement policy settings from system-level settings
  global.db.all(
    `SELECT key, value FROM settings 
     WHERE user_id IS NULL
     AND key IN ('enforce-2fa-all-users', 'enforce-2fa-admins-only', 'twofa-grace-period')`,
    (err, rows) => {
      if (err) {
        console.error('Error checking enforcement policy:', err);
        return callback(false); // Default to not required on error
      }

      let enforce2faAllUsers = false;
      let enforce2faAdminsOnly = false;
      let twoFAGracePeriod = 7;

      if (rows) {
        rows.forEach(row => {
          if (row.key === 'enforce-2fa-all-users') {
            enforce2faAllUsers = row.value === 'true';
          } else if (row.key === 'enforce-2fa-admins-only') {
            enforce2faAdminsOnly = row.value === 'true';
          } else if (row.key === 'twofa-grace-period') {
            twoFAGracePeriod = parseInt(row.value) || 7;
          }
        });
      }

      // Check if 2FA is currently enabled for this user (check both new and old keys)
      global.db.get(
        "SELECT value FROM settings WHERE user_id = ? AND key IN ('twofa_enabled', 'twoFactorEnabled') AND value = 'true' LIMIT 1",
        [user.id],
        (err, tfaRow) => {
          if (err) {
            return callback(false);
          }

          const twoFAEnabled = tfaRow !== undefined;

          // Determine if 2FA is required
          let required = false;

          if (enforce2faAllUsers) {
            // All users required
            required = true;
          } else if (enforce2faAdminsOnly) {
            // Only admins required
            required = user.role === 'admin';
          }

          // If required but not enabled, check enrollment requirements
          if (required && !twoFAEnabled) {
            // Check when 2FA enforcement was enabled
            global.db.get(
              "SELECT updated_at FROM settings WHERE user_id IS NULL AND key IN ('enforce-2fa-all-users', 'enforce-2fa-admins-only') AND value = 'true' ORDER BY updated_at DESC LIMIT 1",
              (err, enforcementRow) => {
                if (err) {
                  console.error('Error checking enforcement date:', err);
                  return callback(true, {
                    required: true,
                    enabled: false,
                    gracePeriod: twoFAGracePeriod,
                    enrollmentRequired: false
                  });
                }

                const enforcementEnabledAt = enforcementRow ? new Date(enforcementRow.created_at) : null;
                const userCreatedAt = new Date(user.created_at);

                // If user was created before 2FA enforcement was enabled, force immediate enrollment
                // If user was created after, they get the grace period
                const forceImmediateEnrollment = enforcementEnabledAt && userCreatedAt < enforcementEnabledAt;

                // Check if user was already flagged for forced enrollment
                global.db.get(
                  "SELECT value FROM settings WHERE user_id = ? AND key = '2faEnrollmentRequired'",
                  [user.id],
                  (err, enrollRow) => {
                    const alreadyFlagged = enrollRow && enrollRow.value === 'true';

                    callback(true, {
                      required: true,
                      enabled: false,
                      gracePeriod: forceImmediateEnrollment ? 0 : twoFAGracePeriod,
                      enrollmentRequired: forceImmediateEnrollment || alreadyFlagged
                    });
                  }
                );
              }
            );
          } else {
            callback(required && !twoFAEnabled, {
              required: required,
              enabled: twoFAEnabled,
              gracePeriod: twoFAGracePeriod,
              enrollmentRequired: false
            });
          }
        }
      );
    }
  );
}

// Helper: Get security settings
function getSecuritySetting(key, defaultValue, callback) {
  global.db.get(
    'SELECT value FROM settings WHERE key = ? AND user_id IS NULL',
    [key],
    (err, row) => {
      if (err) {
        console.error(`Error getting security setting ${key}:`, err);
        return callback(defaultValue);
      }
      const value = row ? row.value : defaultValue;
      
      // Convert string booleans
      if (value === 'true') return callback(true);
      if (value === 'false') return callback(false);
      
      // Convert numbers
      if (!isNaN(value) && value !== '') return callback(Number(value));
      
      callback(value);
    }
  );
}

// Helper: Log audit event
function auditLog(userId, action, details, ipAddress, userAgent) {
  getSecuritySetting('audit-logging', true, (auditEnabled) => {
    if (!auditEnabled) return; // Audit logging disabled

    global.db.run(
      `INSERT INTO activity_log (user_id, action, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, action, details, ipAddress, userAgent],
      (err) => {
        if (err) console.error('Error writing audit log:', err);
      }
    );
  });
}

// Helper: Check if account is locked due to failed login attempts
function checkAccountLockout(userId, callback) {
  getSecuritySetting('max-login-attempts', 5, (maxAttempts) => {
    getSecuritySetting('lockout-duration', 3600, (lockoutDuration) => {
      global.db.get(
        `SELECT failed_attempts, last_failed_attempt FROM users WHERE id = ?`,
        [userId],
        (err, user) => {
          if (err) {
            console.error('Error checking lockout status:', err);
            return callback(false); // Default to not locked
          }

          if (!user || user.failed_attempts < maxAttempts) {
            return callback(false);
          }

          // Check if lockout period has expired
          const lastFailedTime = new Date(user.last_failed_attempt).getTime();
          const now = Date.now();
          const timeSinceLastFailure = (now - lastFailedTime) / 1000; // in seconds

          if (timeSinceLastFailure < lockoutDuration) {
            const minutesRemaining = Math.ceil((lockoutDuration - timeSinceLastFailure) / 60);
            return callback(true, {
              lockedUntil: new Date(lastFailedTime + lockoutDuration * 1000),
              minutesRemaining: minutesRemaining
            });
          }

          // Lockout period expired, reset attempts
          global.db.run(
            'UPDATE users SET failed_attempts = 0, last_failed_attempt = NULL WHERE id = ?',
            [userId],
            (updateErr) => {
              if (updateErr) console.error('Error resetting lockout:', updateErr);
              callback(false);
            }
          );
        }
      );
    });
  });
}

// Helper: Record failed login attempt
function recordFailedAttempt(userId, callback) {
  global.db.run(
    `UPDATE users SET failed_attempts = failed_attempts + 1, last_failed_attempt = CURRENT_TIMESTAMP WHERE id = ?`,
    [userId],
    callback
  );
}

// Helper: Reset failed login attempts on successful login
function resetFailedAttempts(userId, callback) {
  global.db.run(
    `UPDATE users SET failed_attempts = 0, last_failed_attempt = NULL WHERE id = ?`,
    [userId],
    callback
  );
}

// Helper: Validate password policy
function validatePasswordPolicy(password, callback) {
  getSecuritySetting('password-policy', true, (policyEnabled) => {
    if (!policyEnabled) {
      return callback(true); // No policy enforcement
    }

    const issues = [];
    
    if (password.length < 8) issues.push('Password must be at least 8 characters');
    if (!/[A-Z]/.test(password)) issues.push('Must contain uppercase letters');
    if (!/[a-z]/.test(password)) issues.push('Must contain lowercase letters');
    if (!/[0-9]/.test(password)) issues.push('Must contain numbers');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) issues.push('Must contain special characters');

    if (issues.length > 0) {
      return callback(false, issues);
    }

    callback(true);
  });
}

// Helper: Get concurrent sessions for user
function getConcurrentSessions(userId, callback) {
  // This would require storing active sessions - for now return a simple count
  // In a production system, you'd check active JWT tokens or sessions
  global.db.get(
    `SELECT COUNT(*) as count FROM auth_sessions WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP`,
    [userId],
    (err, row) => {
      if (err) {
        console.error('Error getting concurrent sessions:', err);
        return callback(0);
      }
      callback(row ? row.count : 0);
    }
  );
}

// Setup endpoint - Create first admin account (only works if system not initialized)
router.post('/setup', (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    console.log('Setup request received:', { name, email, passwordLength: password?.length });

    // Validate inputs
    if (!name || !email || !password) {
      console.log('Missing inputs:', { name: !!name, email: !!email, password: !!password });
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if system is already initialized
    isSystemInitialized((initialized) => {
      console.log('System initialized check:', initialized);
      if (initialized) {
        return res.status(403).json({ error: 'System is already initialized. Contact your administrator.' });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        console.log('Invalid email format:', email);
        return res.status(400).json({ error: 'Invalid email format' });
      }

      // Validate password strength
      if (password.length < 8) {
        console.log('Password too short:', password.length);
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        console.log('Password missing requirements');
        return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and numbers' });
      }

      // Hash password and create admin user
      console.log('Hashing password with bcrypt...');
      bcrypt.hash(password, 10, (hashErr, passwordHash) => {
        if (hashErr) {
          console.error('Error hashing password:', hashErr);
          return res.status(500).json({ error: 'Failed to create account', details: hashErr.message });
        }

        console.log('Password hashed successfully, creating user...');
        const avatar = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        const username = email.split('@')[0]; // Use email prefix as username for initial setup
        const groups = JSON.stringify(['admins', 'users']);
        const permissions = JSON.stringify({
          canViewServices: true,
          canManageOwnServices: true,
          canViewPerformance: true,
          canManageUsers: true,
          canAccessSettings: true,
          canViewLogs: true,
          canManageSystem: true
        });

        const insertSql = `INSERT INTO users (username, name, display_name, email, password_hash, role, avatar, groups, permissions, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
        
        console.log('Executing insert with avatar:', avatar);

        global.db.run(
          insertSql,
          [username, name, name, email, passwordHash, 'admin', avatar, groups, permissions, 1],
          function(insertErr) {
            if (insertErr) {
              console.error('Error creating admin user:', insertErr);
              if (insertErr.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: 'Email already exists' });
              }
              return res.status(500).json({ error: 'Failed to create admin account', details: insertErr.message });
            }

            console.log('✅ Admin user created: ' + email);

            res.status(201).json({
              message: 'Admin account created successfully',
              user: {
                id: this.lastID,
                name,
                email,
                role: 'admin',
                avatar
              }
            });
          }
        );
      });
    });

  } catch (error) {
    console.error('Setup endpoint error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Setup status endpoint - Check if system is initialized
router.get('/setup/status', (req, res) => {
  isSystemInitialized((initialized) => {
    res.json({ initialized });
  });
});

// Login endpoint - Authenticate user with username or email and password
router.post('/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const loginIdentifier = username || email;

    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: 'Username or email and password are required' });
    }

    // Check if system is initialized
    isSystemInitialized((initialized) => {
      if (!initialized) {
        return res.status(503).json({ error: 'System not initialized. Please complete setup first.', code: 'NOT_INITIALIZED' });
      }

      // Query database for user - try username first, then email as fallback
      const query = 'SELECT * FROM users WHERE username = ? OR email = ?';
      global.db.get(query, [loginIdentifier, loginIdentifier], (err, user) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!user) {
          console.warn(`Login attempt with non-existent username/email: ${loginIdentifier}`);
          return res.status(401).json({ error: 'Invalid username, email or password' });
        }

        // Check if account is locked due to failed attempts
        checkAccountLockout(user.id, (isLocked, lockoutInfo) => {
          if (isLocked) {
            return res.status(429).json({
              error: `Account locked due to too many failed login attempts. Please try again in ${lockoutInfo.minutesRemaining} minutes.`,
              code: 'ACCOUNT_LOCKED',
              lockedUntil: lockoutInfo.lockedUntil
            });
          }

          // Check password
          bcrypt.compare(password, user.password_hash, (err, isMatch) => {
            if (err) {
              console.error('Password comparison error:', err);
              return res.status(500).json({ error: 'Authentication error' });
            }

            if (!isMatch) {
              console.warn(`Failed login attempt for username/email: ${loginIdentifier}`);
              
              // Record failed attempt
              recordFailedAttempt(user.id, (recordErr) => {
                if (recordErr) console.error('Error recording failed attempt:', recordErr);
              });
              
              // Send security notification for failed login
              sendNotification('security', {
                securityEvent: 'Failed Login Attempt',
                email: user.email,
                ipAddress: req.ip,
                severity: 'Medium'
              }).catch(err => console.error('Security notification error:', err));
              
              return res.status(401).json({ error: 'Invalid username, email or password' });
            }

            // Password matches - reset failed attempts
            resetFailedAttempts(user.id, (resetErr) => {
              if (resetErr) console.error('Error resetting failed attempts:', resetErr);
            });

            // Check if user is active
            if (!user.is_active) {
              return res.status(403).json({ error: 'Account is disabled' });
            }

            // Check 2FA enforcement policy
            is2FARequired(user, (isRequired, enforcement) => {
            // Check if 2FA is enabled for this user
            global.db.get(
              "SELECT value FROM settings WHERE user_id = ? AND key = 'twofa_enabled'",
              [user.id],
              (err, tfaRow) => {
                if (err) {
                  console.error('Error checking 2FA status:', err);
                  return res.status(500).json({ error: 'Authentication error' });
                }

                const twoFAEnabled = tfaRow && tfaRow.value === 'true';

                // If 2FA is required but not enabled, block login
                if (isRequired && !twoFAEnabled) {
                  // Check if this is a forced enrollment
                  const enrollmentRequired = enforcement.enrollmentRequired;

                  // Create temporary token for 2FA enrollment
                  const tempToken = jwt.sign(
                    { id: user.id, email: user.email, purpose: '2fa-enrollment' },
                    JWT_SECRET,
                    { expiresIn: '30m' } // 30 minutes for enrollment
                  );

                  return res.status(403).json({
                    error: 'Two-factor authentication is required for your account',
                    code: 'ENROLLMENT_REQUIRED',
                    userId: user.id,
                    enrollmentRequired: enrollmentRequired,
                    tempToken: tempToken,
                    message: enrollmentRequired
                      ? 'Your administrator has required you to set up 2FA. Please complete enrollment.'
                      : `2FA is required. You have a ${enforcement.gracePeriod}-day grace period to set up 2FA.`
                  });
                }

                // If 2FA is enabled, return requiresTwoFactor flag
                if (twoFAEnabled) {
                  const temporaryToken = jwt.sign(
                    { id: user.id, email: user.email },
                    JWT_SECRET,
                    { expiresIn: '5m' } // Short lived token for 2FA
                  );

                  return res.json({
                    requiresTwoFactor: true,
                    userId: user.id,
                    temporaryToken: temporaryToken
                  });
                }

                // If we get here, 2FA is not required or is enabled
                // Parse groups and permissions
                let groups = [];
                let permissions = {};
                try {
                  groups = JSON.parse(user.groups || '[]');
                  permissions = JSON.parse(user.permissions || '{}');
                } catch (e) {
                  console.warn('Error parsing user data:', e);
                }

                // Create JWT token with session timeout from settings
                const tokenData = {
                  id: user.id,
                  username: user.username,
                  name: user.name,
                  displayName: user.display_name || user.name,
                  email: user.email,
                  role: user.role,
                  avatar: user.avatar
                };

                // Get session timeout setting (default 3600 seconds = 1 hour)
                getSecuritySetting('session-timeout', 3600, (sessionTimeout) => {
                  const expiresIn = Math.floor(sessionTimeout); // in seconds
                  const token = jwt.sign(tokenData, JWT_SECRET, { expiresIn: expiresIn });

                  // Update last login timestamp
                  global.db.run(
                    'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?',
                    [user.id]
                  );

                  // Log login activity
                  global.db.run(
                    'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
                    [user.id, 'login', 'User logged in', req.ip, req.get('User-Agent')]
                  );

                  console.log(`User ${user.email} logged in successfully, session timeout: ${expiresIn}s`);
                  // Send login notification
                  sendNotification('login', {
                    username: user.name,
                    email: user.email,
                    ipAddress: req.ip
                  }).catch(err => console.error('Login notification error:', err));

                  res.json({
                    token,
                    user: {
                      id: user.id,
                      username: user.username,
                      name: user.name,
                      displayName: user.display_name || user.name,
                      email: user.email,
                      role: user.role,
                      avatar: user.avatar,
                      groups,
                      permissions
                    }
                  });
                });
              }
            );
            });
          });
        });
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
router.post('/logout', authenticateToken, (req, res) => {
  console.log('Logout request received for user:', req.user?.email);
  
  // Log activity
  global.db.run(
    'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, 'logout', 'User logged out', req.ip, req.get('User-Agent')]
  );

  console.log('Sending logout notification for:', req.user.email);
  // Send logout notification
  sendNotification('logout', {
    username: req.user.name,
    email: req.user.email,
    ipAddress: req.ip
  }).catch(err => console.error('Logout notification error:', err));

  // Clear session
  req.session.destroy();

  res.json({ message: 'Logged out successfully' });
});

// Get current user info
router.get('/me', authenticateToken, (req, res) => {
  global.db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Parse permissions and groups
    let permissions = {};
    let groups = [];

    try {
      permissions = JSON.parse(user.permissions || '{}');
      groups = JSON.parse(user.groups || '[]');
    } catch (e) {
      console.warn('Error parsing user permissions/groups:', e);
    }

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      displayName: user.display_name || user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      ssoProvider: user.sso_provider,
      groups,
      permissions,
      lastLogin: user.last_login,
      loginCount: user.login_count,
      lastActivity: user.last_activity
    });
  });
});

// Refresh token endpoint
router.post('/refresh', authenticateToken, (req, res) => {
  // Generate new token with same user data
  const newToken = jwt.sign(
    {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      name: req.user.name,
      displayName: req.user.displayName,
      role: req.user.role
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token: newToken });
});

// Complete 2FA and return full JWT token
router.post('/2fa-complete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user data
    global.db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Parse groups and permissions
      let groups = [];
      let permissions = {};
      try {
        groups = JSON.parse(user.groups || '[]');
        permissions = JSON.parse(user.permissions || '{}');
      } catch (e) {
        console.warn('Error parsing user data:', e);
      }

      // Create JWT token
      const tokenData = {
        id: user.id,
        username: user.username,
        name: user.name,
        displayName: user.display_name || user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      };

      const token = jwt.sign(tokenData, JWT_SECRET, { expiresIn: '24h' });

      // Update last login timestamp
      global.db.run(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?',
        [user.id]
      );

      // Log login activity
      global.db.run(
        'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
        [user.id, 'login_2fa', 'User logged in with 2FA', req.ip, req.get('User-Agent')]
      );

      // Send login notification
      sendNotification('login', {
        username: user.name,
        email: user.email,
        ipAddress: req.ip
      }).catch(err => console.error('Login notification error:', err));

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          displayName: user.display_name || user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          groups,
          permissions,
          lastLogin: user.last_login,
          loginCount: user.login_count,
          lastActivity: user.last_activity
        }
      });
    });
  } catch (error) {
    console.error('Error completing 2FA:', error);
    res.status(500).json({ error: 'Failed to complete 2FA' });
  }
});

// Initialize demo users (DEPRECATED - use /setup endpoint instead)
// This endpoint is kept for backward compatibility but should not be used
router.post('/init-demo-users', async (req, res) => {
  res.status(410).json({ 
    error: 'Gone',
    message: 'Demo users initialization is deprecated. Use /setup endpoint for initial admin creation.'
  });
});

module.exports = router;
module.exports.authenticateToken = authenticateToken;
module.exports.authenticateFor2FAEnrollment = authenticateFor2FAEnrollment;