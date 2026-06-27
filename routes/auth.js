const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { sendNotification } = require('./notifications');
const { authenticateToken, authenticateFor2FAEnrollment, JWT_SECRET } = require('../middleware/auth');
const db = require('../lib/datalayer');

// Stricter rate limiter for authentication endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per 15 minutes per IP
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Async helper functions ────────────────────────────────────────────────

// Check if system is initialized (any users exist)
async function isSystemInitialized() {
  try {
    const count = await db.users.count();
    return count > 0;
  } catch (err) {
    console.error('Database error checking initialization:', err);
    return false;
  }
}

// Check if 2FA is required for a user based on enforcement policy
async function is2FARequired(user) {
  try {
    const policyKeys = ['enforce-2fa-all-users', 'enforce-2fa-admins-only', 'two-factor-grace-period'];
    const rows = await db.settings.getByKeys(policyKeys);

    let enforce2faAllUsers = false;
    let enforce2faAdminsOnly = false;
    let twoFAGracePeriod = 7;

    if (rows) {
      rows.forEach(row => {
        if (row.key === 'enforce-2fa-all-users') enforce2faAllUsers = row.value === 'true';
        else if (row.key === 'enforce-2fa-admins-only') enforce2faAdminsOnly = row.value === 'true';
        else if (row.key === 'two-factor-grace-period') twoFAGracePeriod = parseInt(row.value) || 7;
      });
    }

    // Check if 2FA is currently enabled for this user
    const twoFAEnabled = await db.twoFactor.isEnabled(user.id);

    // Determine if 2FA is required
    let required = false;
    if (enforce2faAllUsers) {
      required = true;
    } else if (enforce2faAdminsOnly) {
      required = user.role === 'admin';
    }

    // If required but not enabled, check enrollment requirements
    if (required && !twoFAEnabled) {
      // Check when 2FA enforcement was enabled
      const enforceRows = await db.all(
        `SELECT updated_at FROM settings WHERE user_id IS NULL
         AND key IN ('enforce-2fa-all-users', 'enforce-2fa-admins-only')
         AND value = 'true' ORDER BY updated_at DESC LIMIT 1`
      );

      const enforcementRow = enforceRows && enforceRows.length > 0 ? enforceRows[0] : null;
      const enforcementEnabledAt = enforcementRow ? new Date(enforcementRow.updated_at) : null;
      const userCreatedAt = new Date(user.created_at);
      const forceImmediateEnrollment = enforcementEnabledAt && userCreatedAt < enforcementEnabledAt;

      // Check if user was already flagged for forced enrollment
      const enrollmentRequiredVal = await db.settings.get('two_factor_enrollment_required', user.id);
      const alreadyFlagged = enrollmentRequiredVal === 'true';

      return {
        isRequired: true,
        enforcement: {
          required: true,
          enabled: false,
          gracePeriod: forceImmediateEnrollment ? 0 : twoFAGracePeriod,
          enrollmentRequired: forceImmediateEnrollment || alreadyFlagged
        }
      };
    }

    return {
      isRequired: required && !twoFAEnabled,
      enforcement: {
        required: required,
        enabled: twoFAEnabled,
        gracePeriod: twoFAGracePeriod,
        enrollmentRequired: false
      }
    };
  } catch (err) {
    console.error('Error checking enforcement policy:', err);
    return { isRequired: false, enforcement: { required: false, enabled: false, gracePeriod: 7, enrollmentRequired: false } };
  }
}

// Helper: Get security settings
async function getSecuritySetting(key, defaultValue) {
  try {
    const value = await db.settings.getWithDefault(key, defaultValue);
    // Convert string booleans
    if (value === 'true') return true;
    if (value === 'false') return false;
    // Convert numbers
    if (!isNaN(value) && value !== '') return Number(value);
    return value;
  } catch (err) {
    console.error(`Error getting security setting ${key}:`, err);
    return defaultValue;
  }
}

// Helper: Log audit event
async function auditLog(userId, action, details, ipAddress, userAgent) {
  try {
    const auditEnabled = await getSecuritySetting('audit-logging', true);
    if (!auditEnabled) return;
    await db.activityLog.create(userId, action, details, ipAddress, userAgent);
  } catch (err) {
    console.error('Error writing audit log:', err);
  }
}

// Helper: Check if account is locked due to failed login attempts
async function checkAccountLockout(userId) {
  try {
    const [maxAttempts, lockoutDuration, user] = await Promise.all([
      db.settings.getWithDefault('max-login-attempts', 5),
      db.settings.getWithDefault('lockout-duration', 3600),
      db.users.getLockoutInfo(userId)
    ]);

    if (!user || user.failed_attempts < maxAttempts) {
      return { isLocked: false };
    }

    const lastFailedTime = new Date(user.last_failed_attempt).getTime();
    const now = Date.now();
    const timeSinceLastFailure = (now - lastFailedTime) / 1000;

    if (timeSinceLastFailure < lockoutDuration) {
      const minutesRemaining = Math.ceil((lockoutDuration - timeSinceLastFailure) / 60);
      return {
        isLocked: true,
        lockedUntil: new Date(lastFailedTime + lockoutDuration * 1000),
        minutesRemaining
      };
    }

    // Lockout period expired, reset attempts
    await db.users.resetFailedAttempts(userId);
    return { isLocked: false };
  } catch (err) {
    console.error('Error checking lockout status:', err);
    return { isLocked: false };
  }
}

// Helper: Record failed login attempt
async function recordFailedAttempt(userId) {
  try {
    await db.users.incrementFailedAttempts(userId);
  } catch (err) {
    console.error('Error recording failed attempt:', err);
  }
}

// Helper: Reset failed login attempts on successful login
async function resetFailedAttempts(userId) {
  try {
    await db.users.resetFailedAttempts(userId);
  } catch (err) {
    console.error('Error resetting failed attempts:', err);
  }
}

// Helper: Validate password policy
async function validatePasswordPolicy(password) {
  const policyEnabled = await getSecuritySetting('password-policy', true);
  if (!policyEnabled) {
    return { valid: true, issues: [] };
  }

  const issues = [];
  if (password.length < 8) issues.push('Password must be at least 8 characters');
  if (!/[A-Z]/.test(password)) issues.push('Must contain uppercase letters');
  if (!/[a-z]/.test(password)) issues.push('Must contain lowercase letters');
  if (!/[0-9]/.test(password)) issues.push('Must contain numbers');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) issues.push('Must contain special characters');

  return { valid: issues.length === 0, issues };
}

// Helper: Get concurrent sessions for user
async function getConcurrentSessions(userId) {
  try {
    return await db.authSessions.countByUser(userId);
  } catch (err) {
    console.error('Error getting concurrent sessions:', err);
    return 0;
  }
}

// Setup endpoint - Create first admin account (only works if system not initialized)
router.post('/setup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    console.log('Setup request received:', { name, email, passwordLength: password?.length });

    // Validate inputs
    if (!name || !email || !password) {
      console.log('Missing inputs:', { name: !!name, email: !!email, password: !!password });
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if system is already initialized
    const initialized = await isSystemInitialized();
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
    const passwordHash = await bcrypt.hash(password, 10);

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

    const result = await db.run(
      insertSql,
      [username, name, name, email, passwordHash, 'admin', avatar, groups, permissions, 1]
    );

    console.log('✅ Admin user created: ' + email);

    res.status(201).json({
      message: 'Admin account created successfully',
      user: {
        id: result.lastID,
        name,
        email,
        role: 'admin',
        avatar
      }
    });

  } catch (error) {
    console.error('Setup endpoint error:', error);
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Setup status endpoint - Check if system is initialized
router.get('/setup/status', async (req, res) => {
  try {
    const initialized = await isSystemInitialized();
    res.json({ initialized });
  } catch (error) {
    console.error('Setup status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint - Authenticate user with username or email and password
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const loginIdentifier = username || email;

    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: 'Username or email and password are required' });
    }

    // Check if system is initialized
    const initialized = await isSystemInitialized();
    if (!initialized) {
      return res.status(503).json({ error: 'System not initialized. Please complete setup first.', code: 'NOT_INITIALIZED' });
    }

    // Find user by username or email
    const user = await db.users.findByIdentifier(loginIdentifier);
    if (!user) {
      console.warn(`Login attempt with non-existent username/email: ${loginIdentifier}`);
      return res.status(401).json({ error: 'Invalid username, email or password' });
    }

    // Check if account is locked due to failed attempts
    const lockout = await checkAccountLockout(user.id);
    if (lockout.isLocked) {
      return res.status(429).json({
        error: `Account locked due to too many failed login attempts. Please try again in ${lockout.minutesRemaining} minutes.`,
        code: 'ACCOUNT_LOCKED',
        lockedUntil: lockout.lockedUntil
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      console.warn(`Failed login attempt for username/email: ${loginIdentifier}`);

      // Record failed attempt
      await recordFailedAttempt(user.id);

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
    await resetFailedAttempts(user.id);

    // Check if user is active
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    // Check 2FA enforcement policy and status
    const twoFAInfo = await is2FARequired(user);
    const twoFAEnabled = twoFAInfo.enforcement.enabled;

    // If 2FA is required but not enabled, block login with enrollment flow
    if (twoFAInfo.isRequired && !twoFAEnabled) {
      const enrollmentRequired = twoFAInfo.enforcement.enrollmentRequired;

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
          : `2FA is required. You have a ${twoFAInfo.enforcement.gracePeriod}-day grace period to set up 2FA.`
      });
    }

    // If 2FA is enabled, return requiresTwoFactor flag for verification step
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

    // ─── Full login (no 2FA required) ──────────────────────────────────────

    // Parse groups and permissions
    let groups = [];
    let permissions = {};
    try {
      groups = JSON.parse(user.groups || '[]');
      permissions = JSON.parse(user.permissions || '{}');
    } catch (e) {
      console.warn('Error parsing user data:', e);
    }

    // Get session timeout setting (default 3600 seconds = 1 hour)
    const sessionTimeout = await getSecuritySetting('session-timeout', 3600);
    const expiresIn = Math.floor(sessionTimeout); // in seconds

    const tokenData = {
      id: user.id,
      username: user.username,
      name: user.name,
      displayName: user.display_name || user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar
    };

    const token = jwt.sign(tokenData, JWT_SECRET, { expiresIn });

    // Update last login and log activity in parallel
    await Promise.all([
      db.users.updateLastLogin(user.id),
      db.activityLog.create(user.id, 'login', 'User logged in', req.ip, req.get('User-Agent'))
    ]);

    console.log(`User ${user.email} logged in successfully, session timeout: ${expiresIn}s`);

    // Fire-and-forget login notification
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

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
router.post('/logout', authenticateToken, (req, res) => {
  console.log('Logout request received for user:', req.user?.email);
  
  // Log activity (fire-and-forget)
  db.activityLog.create(req.user.id, 'logout', 'User logged out', req.ip, req.get('User-Agent'))
    .catch(err => console.error('Error logging logout:', err));

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
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.users.findById(req.user.id);
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
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
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
    const user = await db.users.findById(userId);
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

    // Update last login and log activity in parallel
    await Promise.all([
      db.users.updateLastLogin(user.id),
      db.activityLog.create(user.id, 'login_2fa', 'User logged in with 2FA', req.ip, req.get('User-Agent'))
    ]);

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

// ─── Password Reset Routes ─────────────────────────────────────────────────

/**
 * Sends a password-reset email directly to a user via configured SMTP.
 * Falls back silently if SMTP is not configured.
 */
async function sendResetEmail(userEmail, username, resetLink) {
  try {
    const [smtpServer, smtpPort, smtpUsername, smtpPasswordRaw, smtpUseTls] = await Promise.all([
      db.settings.getWithDefault('smtp-server', ''),
      db.settings.getWithDefault('smtp-port', '587'),
      db.settings.getWithDefault('smtp-username', ''),
      db.settings.getWithDefault('smtp-password', ''),
      db.settings.getWithDefault('smtp-use-tls', 'false')
    ]);

    if (!smtpServer || !smtpPort || !smtpUsername || !smtpPasswordRaw) {
      console.log('SMTP not configured, skipping password reset email to user');
      return false;
    }

    const smtpPassword = (() => {
      try {
        const decoded = Buffer.from(smtpPasswordRaw, 'base64').toString('utf8');
        return decoded.startsWith('smtp_password:') ? decoded.replace('smtp_password:', '') : smtpPasswordRaw;
      } catch {
        return smtpPasswordRaw;
      }
    })();

    const port = parseInt(smtpPort);
    const transporter = nodemailer.createTransport({
      host: smtpServer,
      port: port,
      secure: port === 465,
      auth: { user: smtpUsername, pass: smtpPassword },
      tls: { rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' },
      requireTLS: smtpUseTls === 'true'
    });

    const mailOptions = {
      from: smtpUsername,
      to: userEmail,
      subject: 'Password Reset Request - Landio Dashboard',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; color: white; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="margin: 0;">Password Reset</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
            <h2>Hello ${username || 'User'},</h2>
            <p>A password reset was requested for your account. Click the button below to reset your password. This link expires in 1 hour.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; display: inline-block;">Reset Password</a>
            </div>
            <p style="color: #999; font-size: 0.85rem;">If you did not request a password reset, please ignore this email and contact your administrator if you have concerns.</p>
            <p style="color: #999; font-size: 0.8rem; margin-top: 20px;">Landio Dashboard - Server Management</p>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to ${userEmail}:`, result.messageId);
    return true;
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return false;
  }
}

/**
 * POST /api/auth/forgot-password
 * Generates a password reset token and sends reset link via email.
 * Body: { email: string }
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    // Check if password reset is enabled
    const resetEnabled = await db.settings.getWithDefault('password-reset-enabled', 'true');
    if (resetEnabled === 'false') {
      return res.status(403).json({ error: 'Password reset is disabled by your administrator' });
    }

    // Find user by email (don't reveal if email exists or not)
    const user = await db.users.findByEmail(email);
    if (!user) {
      // Return success even if email not found to prevent email enumeration
      return res.json({
        message: 'If that email is registered, a password reset link has been sent.',
        resetLink: null
      });
    }

    // Check if user uses SSO (can't reset SSO passwords)
    if (user.sso_provider) {
      return res.json({
        message: 'If that email is registered, a password reset link has been sent.',
        resetLink: null
      });
    }

    // Generate reset token (32 bytes = 64 hex characters)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = parseInt(await db.settings.getWithDefault('password-reset-token-expiry', '60')) || 60;
    const expiresAt = new Date(Date.now() + tokenExpiry * 60 * 1000).toISOString();

    // Store token on user record
    await db.run(
      `UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?`,
      [resetToken, expiresAt, user.id]
    );

    // Build reset link
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const resetLink = `${baseUrl}/reset-password.html?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Try to send email via SMTP
    const emailSent = await sendResetEmail(email, user.name || user.username, resetLink);

    // Notify admins about the password reset request
    sendNotification('password-reset', {
      username: user.name || user.username,
      email: user.email,
      ipAddress: req.ip
    }).catch(err => console.error('Password reset notification error:', err));

    // Log audit event
    db.activityLog.create(user.id, 'password_reset_requested', 'Password reset requested', req.ip, req.get('User-Agent'))
      .catch(err => console.error('Audit log error:', err));

    res.json({
      message: 'If that email is registered, a password reset link has been sent.',
      // In development, include the reset link for convenience
      resetLink: process.env.NODE_ENV === 'development' ? resetLink : (emailSent ? null : resetLink)
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/reset-password
 * Validates reset token and updates the user's password.
 * Body: { token: string, email: string, password: string }
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, email, password } = req.body;

    if (!token || !email || !password) {
      return res.status(400).json({ error: 'Token, email, and new password are required' });
    }

    // Check if password reset is enabled
    const resetEnabled = await db.settings.getWithDefault('password-reset-enabled', 'true');
    if (resetEnabled === 'false') {
      return res.status(403).json({ error: 'Password reset is disabled by your administrator' });
    }

    // Find user by email
    const user = await db.users.findByEmail(email);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Validate token
    if (!user.reset_token || !user.reset_token_expires) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Constant-time comparison to prevent timing attacks
    const tokenBuffer = Buffer.from(token);
    const storedBuffer = Buffer.from(user.reset_token);
    if (tokenBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(tokenBuffer, storedBuffer)) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Check expiration
    const expiresAt = new Date(user.reset_token_expires).getTime();
    if (Date.now() > expiresAt) {
      // Clear expired token
      await db.run(
        `UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?`,
        [user.id]
      );
      return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
    }

    // Validate password against policy
    const policyResult = await validatePasswordPolicy(password);
    if (!policyResult.valid) {
      return res.status(400).json({
        error: 'Password does not meet requirements',
        issues: policyResult.issues
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update password and clear token
    await db.run(
      `UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [passwordHash, user.id]
    );

    // Log audit event
    db.activityLog.create(user.id, 'password_reset_completed', 'Password was reset successfully', req.ip, req.get('User-Agent'))
      .catch(err => console.error('Audit log error:', err));

    console.log(`Password reset completed for user: ${user.email}`);

    res.json({
      message: 'Password has been reset successfully. You can now log in with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;