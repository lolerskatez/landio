const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Get db from global scope instead of requiring server
const getDb = () => global.db;

// ─── SMTP Password encoding / decoding ─────────────────────────────────────────
// Encodes at rest using base64 with a `b64:` prefix for unambiguous detection.
// Existing plaintext passwords are decoded as-is (backward compatible).

const SMTP_PWD_PREFIX = 'b64:';

function smtpPasswordEncode(plaintext) {
  if (!plaintext) return plaintext;
  return SMTP_PWD_PREFIX + Buffer.from(plaintext, 'utf8').toString('base64');
}

function smtpPasswordDecode(stored) {
  if (!stored) return stored;
  if (stored.startsWith(SMTP_PWD_PREFIX)) {
    try {
      return Buffer.from(stored.slice(SMTP_PWD_PREFIX.length), 'base64').toString('utf8');
    } catch {
      // If decoding fails, return the stored value as-is for backward compat
      return stored;
    }
  }
  // No prefix — legacy plaintext, return as-is
  return stored;
}

// ─── SMTP auto-validation helper ──────────────────────────────────────────────
// After settings are saved, if all 4 required SMTP settings are present,
// attempt a connection test and log a warning on failure.

async function autoValidateSmtp(targetUserId) {
  const db = getDb();
  const settings = await new Promise((resolve, reject) => {
    db.all(
      `SELECT key, value FROM settings
       WHERE (user_id = ? OR user_id IS NULL)
         AND key IN ('smtp-server','smtp-port','smtp-username','smtp-password')`,
      [targetUserId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });

  const map = {};
  for (const s of settings) map[s.key] = s.value;

  const server  = map['smtp-server'];
  const port    = map['smtp-port'];
  const username = map['smtp-username'];
  const password = map['smtp-password'];

  if (!server || !port || !username || !password) return; // not all set yet

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: server,
      port: parseInt(port),
      secure: parseInt(port) === 465,
      auth: { user: username, pass: smtpPasswordDecode(password) },
      tls: {
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
      },
      requireTLS: map['smtp-use-tls'] === 'true',
    });
    await transporter.verify();
    console.log('SMTP auto-validation: connection successful');
  } catch (err) {
    console.warn('SMTP auto-validation: connection failed — settings saved but server unreachable:', err.message);
  }
}

// ─── Settings schema / input validation ────────────────────────────────────────
// Defines expected types for known settings keys. Unknown keys are allowed
// through (for extensibility) but type-checked if they match a known key.

const SETTINGS_SCHEMA = {
  // Security & 2FA enforcement
  'enforce-2fa-all-users':         { type: 'boolean' },
  'enforce-2fa-admins-only':       { type: 'boolean' },
  'two-factor-grace-period':       { type: 'number', min: 0, max: 365 },
  'session-timeout':               { type: 'number', min: 60, max: 86400 },
  'max-login-attempts':            { type: 'number', min: 1, max: 100 },
  'lockout-duration':              { type: 'number', min: 1, max: 1440 },
  'password-policy':               { type: 'boolean' },
  'audit-logging':                 { type: 'boolean' },

  // Password reset settings
  'password-reset-enabled':        { type: 'boolean' },
  'password-reset-token-expiry':   { type: 'number', min: 15, max: 1440 },

  // Notification settings
  'discord-enabled':               { type: 'boolean' },
  'discord-webhook':               { type: 'string' },
  'discord-username':              { type: 'string' },
  'smtp-enabled':                  { type: 'boolean' },
  'smtp-server':                   { type: 'string' },
  'smtp-port':                     { type: 'number', min: 1, max: 65535 },
  'smtp-username':                 { type: 'string' },
  'smtp-password':                 { type: 'string' },
  'smtp-use-tls':                  { type: 'boolean' },
  'alert-cc-email':                { type: 'string' },
  'enable-app-notifications':      { type: 'boolean' },
  'enable-user-notifications':     { type: 'boolean' },
  'notify-login':                  { type: 'boolean' },
  'notify-logout':                 { type: 'boolean' },
  'notify-app-start':              { type: 'boolean' },
  'notify-app-stop':               { type: 'boolean' },
  'notify-app-restart':            { type: 'boolean' },
  'notify-errors':                 { type: 'boolean' },
  'notify-security':               { type: 'boolean' },
  'notify-user-activity':          { type: 'boolean' },

  // User preferences (per-user settings)
  'theme':                         { type: 'string' },
  'font-size':                     { type: 'string' },
  'date-format':                   { type: 'string' },
  'chart-theme':                   { type: 'string' },
  'border-radius':                 { type: 'string' },
  'color-scheme':                  { type: 'string' },
  'layout-style':                  { type: 'string' },
  'notification-style':            { type: 'string' },
  'compact-mode':                  { type: 'boolean' },
  'high-contrast':                 { type: 'boolean' },
  'enable-charts':                 { type: 'boolean' },
  'default-language':              { type: 'string' },
  'cloud-provider':                { type: 'string' },
  'cloud-sync-enabled':            { type: 'boolean' },

  // SSO settings
  'sso-enabled':                   { type: 'boolean' },
  'sso-issuer-url':                { type: 'string' },
  'sso-client-id':                 { type: 'string' },
  'sso-client-secret':             { type: 'string' },
  'sso-redirect-uri':              { type: 'string' },
  'sso-scopes':                    { type: 'string' },

  // 2FA user-level settings
  'two_factor_enabled':            { type: 'boolean' },

  // Docker settings
  'docker-auto-detect':            { type: 'boolean' },
  'docker-connection-type':        { type: 'string' },
  'docker-socket-path':            { type: 'string' },
  'docker-tcp-host':               { type: 'string' },
  'docker-tcp-port':               { type: 'number', min: 1, max: 65535 },
  'docker-tls-enabled':            { type: 'boolean' },

  // System control settings
  'system-reboot-enabled':         { type: 'boolean' },
  'system-shutdown-enabled':       { type: 'boolean' },
  'system-reboot-delay':           { type: 'number', min: 10, max: 600 },
  'system-reboot-require-reason':  { type: 'boolean' },
  'system-reboot-allow-poweruser': { type: 'boolean' },
  'system-ssh-host':               { type: 'string' },
  'system-ssh-key-path':           { type: 'string' },
};

/**
 * Validates a single setting value against the schema.
 * Logs a warning for type mismatches but does NOT block the save
 * (to avoid breaking existing functionality).
 * Returns the coerced value if applicable.
 */
function validateSettingValue(key, value) {
  const rule = SETTINGS_SCHEMA[key];
  if (!rule) return value; // Unknown key — pass through

  const strVal = String(value);

  switch (rule.type) {
    case 'boolean': {
      const normalized = strVal.toLowerCase();
      if (['true', 'false', '1', '0'].includes(normalized)) return normalized === 'true' || normalized === '1' ? 'true' : 'false';
      console.warn(`[settings] Invalid boolean value for "${key}": "${value}" — coercing to "false"`);
      return 'false';
    }
    case 'number': {
      const num = Number(strVal);
      if (isNaN(num)) {
        console.warn(`[settings] Invalid number value for "${key}": "${value}" — using default fallback`);
        return String(rule.min ?? 0);
      }
      const clamped = Math.max(rule.min ?? -Infinity, Math.min(rule.max ?? Infinity, num));
      if (clamped !== num) {
        console.warn(`[settings] Clamped "${key}" from ${num} to ${clamped} (range: ${rule.min ?? '−∞'}–${rule.max ?? '∞'})`);
      }
      return String(clamped);
    }
    case 'string':
    default:
      return strVal;
  }
}

// ─── Settings handlers ─────────────────────────────────────────────────────────

// GET /api/settings - Get all settings (system + user-specific)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get system settings (user_id = NULL)
    const systemSettings = await new Promise((resolve, reject) => {
      getDb().all(
        'SELECT key, value, category FROM settings WHERE user_id IS NULL',
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Get user-specific settings
    const userSettings = await new Promise((resolve, reject) => {
      getDb().all(
        'SELECT key, value, category FROM settings WHERE user_id = ?',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Merge settings (user settings override system settings)
    const settingsMap = {};
    
    systemSettings.forEach(setting => {
      settingsMap[setting.key] = {
        value: setting.key === 'smtp-password' ? smtpPasswordDecode(setting.value) : setting.value,
        category: setting.category,
        scope: 'system'
      };
    });

    userSettings.forEach(setting => {
      settingsMap[setting.key] = {
        value: setting.key === 'smtp-password' ? smtpPasswordDecode(setting.value) : setting.value,
        category: setting.category,
        scope: 'user'
      };
    });

    res.json({ settings: settingsMap });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// GET /api/settings/system-preferences - Get system-level preferences (admin only)
router.get('/system-preferences', authenticateToken, async (req, res) => {
  try {
    // Only admins can view system preferences
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const db = getDb();

    // Get system-level settings
    const settings = await new Promise((resolve, reject) => {
      db.all(
        'SELECT key, value FROM settings WHERE user_id IS NULL',
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Build preferences object
    const preferences = {};
    settings.forEach(setting => {
      preferences[setting.key] = setting.value;
    });

    // Set defaults for preferences that have no value yet
    const defaults = {
      'smtp-server': '',
      'smtp-port': '587',
      'smtp-username': '',
      'smtp-password': '',
      'smtp-use-tls': 'true',
      'smtp-enabled': 'false',
      'discord-webhook': '',
      'discord-username': '',
      'discord-enabled': 'false',
      'alert-cc-email': '',
      'enable-app-notifications': 'true',
      'enable-user-notifications': 'true',
      'notify-login': 'true',
      'notify-logout': 'true',
      'notify-app-start': 'true',
      'notify-app-stop': 'true',
      'notify-app-restart': 'true',
      'notify-errors': 'true',
      'notify-security': 'true',
      'notify-user-activity': 'true',
      'session-timeout': '30',
      'max-login-attempts': '5',
      'lockout-duration': '15',
      'password-min-length': '8',
      'password-require-uppercase': 'true',
      'password-require-lowercase': 'true',
      'password-require-numbers': 'true',
      'password-require-special': 'false',
      'enforce-2fa-all-users': 'false',
      'enforce-2fa-admins-only': 'false',
      'two-factor-grace-period': '7',

      // Docker defaults
      'docker-auto-detect': 'true',
      'docker-connection-type': 'socket',
      'docker-socket-path': '/var/run/docker.sock',
      'docker-tcp-host': '',
      'docker-tcp-port': '2375',
      'docker-tls-enabled': 'false',

      // System control defaults
      'system-reboot-enabled': 'true',
      'system-shutdown-enabled': 'true',
      'system-reboot-delay': '60',
      'system-reboot-require-reason': 'true',
      'system-reboot-allow-poweruser': 'false',
      'system-ssh-host': '',
      'system-ssh-key-path': ''
    };

    // Apply defaults and decode SMTP password
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (preferences[key] === undefined) {
        preferences[key] = defaultValue;
      } else if (key === 'smtp-password') {
        preferences[key] = smtpPasswordDecode(preferences[key]);
      }
    }

    res.json({ preferences });
  } catch (error) {
    console.error('Error fetching system preferences:', error);
    res.status(500).json({ error: 'Failed to fetch system preferences' });
  }
});

// ─── Theme Preferences (per-user) ──────────────────────────────────────────
// These endpoints serve the ThemeManager class in theme.js, translating
// between the structured client format and individual key-value settings rows.

// GET /api/settings/theme/preferences - Get user's theme preferences
router.get('/theme/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDb();

    // Keys used to store theme preferences (camelCase to match settings.html convention)
    const themeKeys = ['darkMode', 'theme', 'fontSize', 'highContrast', 'reduceMotion', 'animations'];

    // Try user-specific settings first
    const userSettings = await new Promise((resolve, reject) => {
      const placeholders = themeKeys.map(() => '?').join(',');
      db.all(
        `SELECT key, value FROM settings WHERE user_id = ? AND key IN (${placeholders})`,
        [userId, ...themeKeys],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Build a map from stored keys
    const stored = {};
    userSettings.forEach(s => { stored[s.key] = s.value; });

    // For any missing keys, fall back to system-level settings
    const missingKeys = themeKeys.filter(k => stored[k] === undefined);
    if (missingKeys.length > 0) {
      const systemSettings = await new Promise((resolve, reject) => {
        const placeholders = missingKeys.map(() => '?').join(',');
        db.all(
          `SELECT key, value FROM settings WHERE user_id IS NULL AND key IN (${placeholders})`,
          missingKeys,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
      systemSettings.forEach(s => {
        if (stored[s.key] === undefined) stored[s.key] = s.value;
      });
    }

    // Default values for any still-missing keys
    const defaults = {
      darkMode: 'false',
      theme: 'pastel',
      fontSize: 'medium',
      highContrast: 'false',
      reduceMotion: 'false',
      animations: 'true'
    };
    for (const key of themeKeys) {
      if (stored[key] === undefined) {
        stored[key] = defaults[key];
      }
    }

    // Map stored keys to the client-expected format (camelCase with isDarkMode)
    const preferences = {
      isDarkMode: stored.darkMode === 'true',
      theme: stored.theme,
      fontSize: stored.fontSize,
      highContrast: stored.highContrast === 'true',
      reduceMotion: stored.reduceMotion === 'true',
      animations: stored.animations === 'true'
    };

    res.json({ preferences });
  } catch (error) {
    console.error('Error fetching theme preferences:', error);
    res.status(500).json({ error: 'Failed to fetch theme preferences' });
  }
});

// POST /api/settings/theme/preferences - Save user's theme preferences
router.post('/theme/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDb();
    const prefs = req.body;

    if (!prefs || typeof prefs !== 'object') {
      return res.status(400).json({ error: 'Invalid theme preferences data' });
    }

    // Map client properties to stored keys with value conversion
    const mappings = [
      { clientKey: 'isDarkMode',    dbKey: 'darkMode',      transform: v => String(v === true || v === 'true') },
      { clientKey: 'theme',         dbKey: 'theme',         transform: v => String(v) },
      { clientKey: 'fontSize',      dbKey: 'fontSize',      transform: v => String(v) },
      { clientKey: 'highContrast',  dbKey: 'highContrast',  transform: v => String(v === true || v === 'true') },
      { clientKey: 'reduceMotion',  dbKey: 'reduceMotion',  transform: v => String(v === true || v === 'true') },
      { clientKey: 'animations',    dbKey: 'animations',    transform: v => String(v === true || v === 'true') }
    ];

    const stmt = db.prepare(`
      INSERT INTO settings (user_id, key, value, category, updated_at)
      VALUES (?, ?, ?, 'appearance', datetime('now'))
      ON CONFLICT(user_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `);

    let count = 0;
    for (const mapping of mappings) {
      if (prefs[mapping.clientKey] !== undefined) {
        const value = mapping.transform(prefs[mapping.clientKey]);
        await new Promise((resolve, reject) => {
          stmt.run(userId, mapping.dbKey, value, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        count++;
      }
    }

    stmt.finalize();

    res.json({
      success: true,
      message: 'Theme preferences saved successfully',
      updated: count
    });
  } catch (error) {
    console.error('Error saving theme preferences:', error);
    res.status(500).json({ error: 'Failed to save theme preferences' });
  }
});

// GET /api/settings/:key - Get specific setting
router.get('/:key', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const key = req.params.key;

    // First try to get user-specific setting
    const userSetting = await new Promise((resolve, reject) => {
      getDb().get(
        'SELECT value, category FROM settings WHERE user_id = ? AND key = ?',
        [userId, key],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (userSetting) {
      return res.json({ 
        key, 
        value: key === 'smtp-password' ? smtpPasswordDecode(userSetting.value) : userSetting.value, 
        category: userSetting.category,
        scope: 'user'
      });
    }

    // Fall back to system setting
    const systemSetting = await new Promise((resolve, reject) => {
      getDb().get(
        'SELECT value, category FROM settings WHERE user_id IS NULL AND key = ?',
        [key],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (systemSetting) {
      return res.json({ 
        key, 
        value: key === 'smtp-password' ? smtpPasswordDecode(systemSetting.value) : systemSetting.value, 
        category: systemSetting.category,
        scope: 'system'
      });
    }

    res.status(404).json({ error: 'Setting not found' });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// PUT /api/settings - Update multiple settings
router.put('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { settings, scope = 'user' } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Invalid settings data' });
    }

    // Only admins can update system settings
    if (scope === 'system' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required for system settings' });
    }

    const targetUserId = scope === 'system' ? null : userId;

    // Update each setting
    const stmt = getDb().prepare(`
      INSERT INTO settings (user_id, key, value, category, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `);

    for (const [key, data] of Object.entries(settings)) {
      let value = typeof data === 'object' ? data.value : data;
      const category = typeof data === 'object' ? data.category : null;
      
      // Encode SMTP password at rest
      if (key === 'smtp-password' && value) {
        value = smtpPasswordEncode(value);
      }

      await new Promise((resolve, reject) => {
        stmt.run(targetUserId, key, String(value), category, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    stmt.finalize();

    // Auto-validate SMTP if all required settings are present
    autoValidateSmtp(targetUserId).catch(() => {});

    res.json({ 
      success: true, 
      message: 'Settings updated successfully',
      count: Object.keys(settings).length
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// PUT /api/settings/:key - Update specific setting
router.put('/:key', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const key = req.params.key;
    const { value, category, scope = 'user' } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'Value is required' });
    }

    // Only admins can update system settings
    if (scope === 'system' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required for system settings' });
    }

    const targetUserId = scope === 'system' ? null : userId;

    // Encode SMTP password at rest
    let finalValue = String(value);
    if (key === 'smtp-password' && finalValue) {
      finalValue = smtpPasswordEncode(finalValue);
    }

    await new Promise((resolve, reject) => {
      getDb().run(`
        INSERT INTO settings (user_id, key, value, category, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, key) DO UPDATE SET
          value = excluded.value,
          category = excluded.category,
          updated_at = datetime('now')
      `, [targetUserId, key, finalValue, category], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Auto-validate SMTP if all required settings are present
    autoValidateSmtp(targetUserId).catch(() => {});

    res.json({ 
      success: true, 
      message: 'Setting updated successfully',
      key,
      value
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// POST /api/settings - Create/update a single setting
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { key, value, category = 'general', scope = 'user' } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key and value are required' });
    }

    // Only admins can create/update system settings
    if (scope === 'system' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required for system settings' });
    }

    const targetUserId = scope === 'system' ? null : userId;

    // Encode SMTP password at rest
    let finalValue = String(value);
    if (key === 'smtp-password' && finalValue) {
      finalValue = smtpPasswordEncode(finalValue);
    }

    await new Promise((resolve, reject) => {
      getDb().run(`
        INSERT INTO settings (user_id, key, value, category, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, key) DO UPDATE SET
          value = excluded.value,
          category = excluded.category,
          updated_at = datetime('now')
      `, [targetUserId, key, finalValue, category], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Auto-validate SMTP if all required settings are present
    autoValidateSmtp(targetUserId).catch(() => {});

    res.json({ 
      success: true, 
      message: 'Setting created/updated successfully',
      key,
      value,
      category
    });
  } catch (error) {
    console.error('Error creating/updating setting:', error);
    res.status(500).json({ error: 'Failed to create/update setting' });
  }
});

// DELETE /api/settings/:key - Delete specific setting (admin only for system, users can delete their own)
router.delete('/:key', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const key = req.params.key;
    const { scope = 'user' } = req.body;

    // Only admins can delete system settings
    if (scope === 'system' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required for system settings' });
    }

    const targetUserId = scope === 'system' ? null : userId;

    await new Promise((resolve, reject) => {
      getDb().run(
        'DELETE FROM settings WHERE user_id IS ? AND key = ?',
        [targetUserId, key],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ 
      success: true, 
      message: 'Setting deleted successfully',
      key
    });
  } catch (error) {
    console.error('Error deleting setting:', error);
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

// POST /api/settings/test-smtp - Test SMTP configuration (admin only)
router.post('/test-smtp', authenticateToken, async (req, res) => {
  try {
    // Only admins can test SMTP
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get SMTP settings
    const db = getDb();
    const getSmtpSetting = (key) => {
      return new Promise((resolve, reject) => {
        // Try user settings first, then system settings
        db.get(
          'SELECT value FROM settings WHERE key = ? AND user_id = ? UNION SELECT value FROM settings WHERE key = ? AND user_id IS NULL LIMIT 1',
          [key, req.user.id, key],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.value || null);
          }
        );
      });
    };

    const smtpServer = await getSmtpSetting('smtp-server');
    const smtpPort = await getSmtpSetting('smtp-port');
    const smtpUsername = await getSmtpSetting('smtp-username');
    const smtpPasswordRaw = await getSmtpSetting('smtp-password');
    const smtpUseTls = await getSmtpSetting('smtp-use-tls');

    // Decode SMTP password (may be base64-encoded)
    const smtpPassword = smtpPasswordDecode(smtpPasswordRaw);

    console.log('SMTP Settings retrieved:', { smtpServer, smtpPort, smtpUsername: smtpUsername ? '***' : 'missing', smtpPassword: smtpPassword ? '***' : 'missing', smtpUseTls });

    // Validate settings
    if (!smtpServer || !smtpPort || !smtpUsername || !smtpPassword) {
      console.log('SMTP configuration incomplete for user', req.user.id);
      return res.status(400).json({ 
        error: 'SMTP configuration incomplete',
        details: {
          server: !smtpServer ? 'missing' : 'ok',
          port: !smtpPort ? 'missing' : 'ok',
          username: !smtpUsername ? 'missing' : 'ok',
          password: !smtpPassword ? 'missing' : 'ok'
        }
      });
    }

    try {
      const nodemailer = require('nodemailer');

      // Create transporter
      const port = parseInt(smtpPort);
      const transporter = nodemailer.createTransport({
        host: smtpServer,
        port: port,
        secure: port === 465, // true for 465 (SSL), false for 587 (STARTTLS)
        auth: {
          user: smtpUsername,
          pass: smtpPassword
        },
        tls: {
          rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
        },
        requireTLS: smtpUseTls === 'true' // Force STARTTLS for port 587
      });

      // Test connection
      const verified = await transporter.verify();
      
      if (!verified) {
        return res.status(400).json({ 
          error: 'SMTP authentication failed',
          message: 'Could not authenticate with the SMTP server'
        });
      }

      // Send test email to admin
      const testRecipient = req.body.recipient || req.user.email;
      
      const mailOptions = {
        from: smtpUsername,
        to: testRecipient,
        subject: '🧪 SMTP Test - Landio Dashboard',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; color: white; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0;">SMTP Test Email</h1>
              <p style="margin: 5px 0 0 0; opacity: 0.9;">From Landio Dashboard</p>
            </div>
            
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
              <h2 style="color: #333;">✅ SMTP Configuration is Working!</h2>
              
              <p>If you're reading this email, your SMTP configuration is correctly set up and functioning.</p>
              
              <div style="background: white; padding: 20px; border-left: 4px solid #667eea; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #667eea;">Configuration Details</h3>
                <ul style="color: #666; line-height: 1.8;">
                  <li><strong>Server:</strong> ${smtpServer}:${smtpPort}</li>
                  <li><strong>TLS/SSL:</strong> ${smtpUseTls === 'true' ? 'Enabled' : 'Disabled'}</li>
                  <li><strong>Test Time:</strong> ${new Date().toLocaleString()}</li>
                </ul>
              </div>
              
              <p style="color: #999; font-size: 12px; margin-top: 30px;">
                This is an automated test email from your Landio Dashboard. 
                If you did not request this email, you can safely ignore it.
              </p>
            </div>
          </div>
        `,
        text: `SMTP Test Email\n\nIf you're reading this, your SMTP configuration is working!\n\nServer: ${smtpServer}:${smtpPort}\nTime: ${new Date().toLocaleString()}`
      };

      const result = await transporter.sendMail(mailOptions);

      res.json({ 
        success: true,
        message: 'SMTP test successful - email sent',
        details: {
          recipient: testRecipient,
          messageId: result.messageId,
          response: result.response,
          timestamp: new Date().toISOString()
        }
      });

    } catch (smtpError) {
      console.error('SMTP test failed:', smtpError.message, 'Code:', smtpError.code);
      res.status(400).json({ 
        error: 'SMTP error',
        message: smtpError.message,
        code: smtpError.code,
        details: smtpError.response || smtpError.responseCode
      });
    }

  } catch (error) {
    console.error('Error testing SMTP:', error);
    res.status(500).json({ error: 'Failed to test SMTP configuration' });
  }
});

// POST /api/settings/test-discord - Test Discord webhook configuration (admin only)
router.post('/test-discord', authenticateToken, async (req, res) => {
  try {
    console.log('Discord test request received:', req.body);
    
    // Only admins can test Discord
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get Discord settings
    const db = getDb();
    const getDiscordSetting = (key) => {
      return new Promise((resolve, reject) => {
        db.get(
          'SELECT value FROM settings WHERE key = ? AND (user_id = ? OR user_id IS NULL) ORDER BY user_id DESC LIMIT 1',
          [key, req.user.id],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.value || null);
          }
        );
      });
    };

    const webhookUrl = await getDiscordSetting('discord-webhook');
    const botUsername = await getDiscordSetting('discord-username');

    console.log('Discord settings:', { webhookUrl: webhookUrl ? 'configured' : 'missing', botUsername });

    if (!webhookUrl) {
      return res.status(400).json({ error: 'Discord webhook URL not configured' });
    }

    try {
      const axios = require('axios');
      
      const timestamp = new Date().toLocaleString();
      const testMessage = {
        username: botUsername || 'Landio Bot',
        embeds: [
          {
            title: '🧪 Discord Test - Landio Dashboard',
            description: 'If you see this message, your Discord webhook is configured correctly!',
            color: 65280, // Green
            fields: [
              {
                name: 'Test Time',
                value: timestamp,
                inline: true
              },
              {
                name: 'Status',
                value: '✅ Success',
                inline: true
              }
            ],
            timestamp: new Date().toISOString()
          }
        ]
      };

      await axios.post(webhookUrl, testMessage);

      res.json({ 
        success: true,
        message: 'Discord test successful - message sent',
        details: {
          webhook: webhookUrl ? 'configured' : 'not set',
          timestamp: new Date().toISOString()
        }
      });

    } catch (discordError) {
      console.error('Discord test failed:', discordError.message);
      res.status(400).json({ 
        error: 'Discord error',
        message: discordError.message,
        details: discordError.response?.data
      });
    }

  } catch (error) {
    console.error('Error testing Discord:', error);
    res.status(500).json({ error: 'Failed to test Discord configuration' });
  }
});

// POST /api/settings/system-preferences - Update system-level preferences
router.post('/system-preferences', authenticateToken, async (req, res) => {
  try {
    // Only admins can update system preferences
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const db = getDb();
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ error: 'Invalid preferences data' });
    }

    console.log('Updating system preferences:', Object.keys(preferences));

    // Update each preference
    for (const [key, value] of Object.entries(preferences)) {
      // Encode SMTP password at rest
      let finalValue = String(value);
      if (key === 'smtp-password' && finalValue) {
        finalValue = smtpPasswordEncode(finalValue);
      }

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO settings (user_id, key, value, category, updated_at)
           VALUES (NULL, ?, ?, 'system', datetime('now'))
           ON CONFLICT(user_id, key) DO UPDATE SET
             value = excluded.value,
             category = excluded.category,
             updated_at = datetime('now')`,
          [key, finalValue],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    // Auto-validate SMTP after saving system preferences
    autoValidateSmtp(null).catch(() => {});

    res.json({ 
      success: true, 
      message: 'System preferences updated successfully'
    });
  } catch (error) {
    console.error('Error updating system preferences:', error);
    res.status(500).json({ error: 'Failed to update system preferences' });
  }
});

module.exports = router;
