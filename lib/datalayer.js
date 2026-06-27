/**
 * Data Layer — Centralized database access module.
 *
 * Wraps all SQLite3 operations with Promises to eliminate callback hell
 * and provide a single mockable interface for testing.
 *
 * Usage:
 *   const db = require('../lib/datalayer');
 *   // After DB is initialized in server.js:
 *   db.initialize(global.db);
 *   // Then in route files:
 *   const user = await db.users.findById(userId);
 *   const setting = await db.settings.get('smtp-server');
 */

let _db = null;

function getDb() {
  if (!_db) {
    throw new Error('Database not initialized. Call datalayer.initialize(db) first.');
  }
  return _db;
}

// ─── Initialization ───────────────────────────────────────────────────────────

function initialize(db) {
  _db = db;
}

// ─── Generic Promise-based wrappers ───────────────────────────────────────────

/**
 * Run a query that returns a single row (db.get).
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<object|undefined>}
 */
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Run a query that returns multiple rows (db.all).
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<object[]>}
 */
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * Run a query that modifies data (db.run).
 * @param {string} sql
 * @param {Array} [params=[]]
 * @returns {Promise<{lastID: number, changes: number}>}
 */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// ─── User domain ──────────────────────────────────────────────────────────────

const users = {
  /**
   * Find a user by primary key.
   * @param {number} id
   * @returns {Promise<object|undefined>}
   */
  findById(id) {
    return get('SELECT * FROM users WHERE id = ?', [id]);
  },

  /**
   * Find a user by email address.
   * @param {string} email
   * @returns {Promise<object|undefined>}
   */
  findByEmail(email) {
    return get('SELECT * FROM users WHERE email = ?', [email]);
  },

  /**
   * Find a user by username.
   * @param {string} username
   * @returns {Promise<object|undefined>}
   */
  findByUsername(username) {
    return get('SELECT * FROM users WHERE username = ?', [username]);
  },

  /**
   * Find a user by username or email (for login).
   * @param {string} identifier
   * @returns {Promise<object|undefined>}
   */
  findByIdentifier(identifier) {
    return get(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [identifier, identifier]
    );
  },

  /**
   * Find a user by SSO ID.
   * @param {string} ssoId
   * @returns {Promise<object|undefined>}
   */
  findBySsoId(ssoId) {
    return get('SELECT id, name, display_name, email, role FROM users WHERE sso_id = ?', [ssoId]);
  },

  /**
   * Get all users.
   * @returns {Promise<object[]>}
   */
  findAll() {
    return all('SELECT * FROM users ORDER BY created_at DESC');
  },

  /**
   * Count total users.
   * @returns {Promise<number>}
   */
  count() {
    return get('SELECT COUNT(*) as count FROM users').then(row => row.count);
  },

  /**
   * Create a new user.
   * @param {object} data
   * @returns {Promise<{lastID: number}>}
   */
  create(data) {
    const {
      username, name, display_name, email, password,
      role = 'user', avatar = null, groups = null,
      permissions = null, is_active = 1, sso_id = null
    } = data;
    return run(
      `INSERT INTO users (username, name, display_name, email, password, role, avatar, groups, permissions, is_active, sso_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, name, display_name, email, password, role, avatar, groups, permissions, is_active, sso_id]
    );
  },

  /**
   * Update a user. Builds SET clause dynamically from provided fields.
   * @param {number} id
   * @param {object} data — keys: username, name, display_name, email, password, role, avatar, groups, permissions, is_active
   * @returns {Promise<{changes: number}>}
   */
  update(id, data) {
    const allowed = ['username', 'name', 'display_name', 'email', 'password', 'role', 'avatar', 'groups', 'permissions', 'is_active'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        sets.push(`${key} = ?`);
        params.push(data[key]);
      }
    }
    if (sets.length === 0) return Promise.resolve({ changes: 0 });
    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);
    return run(
      `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
  },

  /**
   * Delete a user by ID.
   * @param {number} id
   * @returns {Promise<{changes: number}>}
   */
  delete(id) {
    return run('DELETE FROM users WHERE id = ?', [id]);
  },

  /**
   * Get admin email addresses.
   * @returns {Promise<string[]>}
   */
  getAdminEmails() {
    return all(
      'SELECT email FROM users WHERE role = ? AND is_active = ?',
      ['admin', true]
    ).then(rows => rows.map(r => r.email));
  },

  // ── Auth-specific helpers ──

  incrementFailedAttempts(userId) {
    return run(
      'UPDATE users SET failed_attempts = failed_attempts + 1, last_failed_attempt = CURRENT_TIMESTAMP WHERE id = ?',
      [userId]
    );
  },

  resetFailedAttempts(userId) {
    return run(
      'UPDATE users SET failed_attempts = 0, last_failed_attempt = NULL WHERE id = ?',
      [userId]
    );
  },

  updateLastLogin(userId) {
    return run(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?',
      [userId]
    );
  },

  /**
   * Get lockout info for a user.
   * @param {number} userId
   * @returns {Promise<object|undefined>}
   */
  getLockoutInfo(userId) {
    return get(
      'SELECT failed_attempts, last_failed_attempt FROM users WHERE id = ?',
      [userId]
    );
  },

  /**
   * Mark onboarding as completed.
   * @param {number} userId
   * @returns {Promise}
   */
  completeOnboarding(userId) {
    return run(
      "UPDATE users SET onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [userId]
    );
  },
};

// ─── Settings domain ──────────────────────────────────────────────────────────

const settings = {
  /**
   * Get a single setting value.
   * @param {string} key
   * @param {number|null} [userId=null] — null means system-level setting
   * @returns {Promise<string|null>}
   */
  get(key, userId = null) {
    let query = 'SELECT value FROM settings WHERE key = ?';
    const params = [key];
    if (userId) {
      query += ' AND (user_id = ? OR user_id IS NULL) ORDER BY user_id DESC LIMIT 1';
      params.push(userId);
    } else {
      query += ' AND user_id IS NULL LIMIT 1';
    }
    return get(query, params).then(row => (row ? row.value : null));
  },

  /**
   * Get a setting with a fallback default value.
   * @param {string} key
   * @param {*} defaultValue
   * @param {number|null} [userId=null]
   * @returns {Promise<*>}
   */
  getWithDefault(key, defaultValue, userId = null) {
    return this.get(key, userId).then(val => (val !== null ? val : defaultValue));
  },

  /**
   * Set (insert or replace) a setting.
   * @param {string} key
   * @param {string|number|boolean} value
   * @param {number|null} [userId=null]
   * @param {string} [category='general']
   * @returns {Promise}
   */
  set(key, value, userId = null, category = 'general') {
    return run(
      `INSERT INTO settings (user_id, key, value, category, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, key) DO UPDATE SET
         value = excluded.value,
         category = excluded.category,
         updated_at = datetime('now')`,
      [userId, key, String(value), category]
    );
  },

  /**
   * Delete a setting.
   * @param {string} key
   * @param {number|null} [userId=null]
   * @returns {Promise}
   */
  delete(key, userId = null) {
    return run(
      'DELETE FROM settings WHERE user_id IS ? AND key = ?',
      [userId, key]
    );
  },

  /**
   * Get all settings for a user (excluding system-level).
   * @param {number} userId
   * @returns {Promise<object[]>} — array of {key, value} rows
   */
  getByUser(userId) {
    return all(
      'SELECT key, value FROM settings WHERE user_id = ?',
      [userId]
    );
  },

  /**
   * Get system-level settings (user_id IS NULL).
   * @param {string} [keyPrefix] — optional filter by key prefix
   * @returns {Promise<object[]>}
   */
  getSystemSettings(keyPrefix = null) {
    let query = 'SELECT key, value FROM settings WHERE user_id IS NULL';
    const params = [];
    if (keyPrefix) {
      query += ' AND key LIKE ?';
      params.push(`${keyPrefix}%`);
    }
    return all(query, params);
  },

  /**
   * Get setting keys matching a list (for enforcement policies, etc.).
   * @param {string[]} keys
   * @param {number|null} [userId=null]
   * @returns {Promise<object[]>}
   */
  getByKeys(keys, userId = null) {
    const placeholders = keys.map(() => '?').join(',');
    let query = `SELECT key, value FROM settings WHERE key IN (${placeholders})`;
    const params = [...keys];
    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    } else {
      query += ' AND user_id IS NULL';
    }
    return all(query, params);
  },

  /**
   * Delete multiple settings for a user by key list.
   * @param {string[]} keys
   * @param {number} userId
   * @returns {Promise}
   */
  deleteByKeys(keys, userId) {
    const placeholders = keys.map(() => '?').join(',');
    return run(
      `DELETE FROM settings WHERE user_id = ? AND key IN (${placeholders})`,
      [userId, ...keys]
    );
  },

  /**
   * Count users with a specific setting key and value.
   * @param {string} key
   * @param {string} value
   * @returns {Promise<number>}
   */
  countUsersWithSetting(key, value) {
    return get(
      `SELECT COUNT(*) as count FROM settings WHERE key = ? AND value = ?`,
      [key, value]
    ).then(row => row.count);
  },
};

// ─── Activity Log domain ──────────────────────────────────────────────────────

const activityLog = {
  /**
   * Create an activity log entry.
   * @param {number} userId
   * @param {string} action
   * @param {string} [details='']
   * @param {string} [ipAddress='']
   * @param {string} [userAgent='']
   * @returns {Promise}
   */
  create(userId, action, details = '', ipAddress = '', userAgent = '') {
    return run(
      `INSERT INTO activity_log (user_id, action, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, action, details, ipAddress, userAgent]
    );
  },

  /**
   * Get activity log entries for a specific user.
   * @param {number} userId
   * @param {number} [limit=50]
   * @returns {Promise<object[]>}
   */
  getByUser(userId, limit = 50) {
    return all(
      'SELECT * FROM activity_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?',
      [userId, limit]
    );
  },

  /**
   * Get all activity log entries.
   * @param {number} [limit=100]
   * @returns {Promise<object[]>}
   */
  getAll(limit = 100) {
    return all(
      'SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
  },
};

// ─── Auth Sessions domain ─────────────────────────────────────────────────────

const authSessions = {
  /**
   * Count active sessions for a user.
   * @param {number} userId
   * @returns {Promise<number>}
   */
  countByUser(userId) {
    return get(
      'SELECT COUNT(*) as count FROM auth_sessions WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP',
      [userId]
    ).then(row => row.count);
  },
};

// ─── SSO Config domain ────────────────────────────────────────────────────────

const ssoConfig = {
  /**
   * Get the SSO configuration JSON.
   * @returns {Promise<object|null>}
   */
  get() {
    return get(
      "SELECT value FROM settings WHERE user_id IS NULL AND key = 'sso-config'"
    ).then(row => {
      if (!row) return null;
      try { return JSON.parse(row.value); }
      catch { return null; }
    });
  },

  /**
   * Save SSO configuration.
   * @param {object} config
   * @returns {Promise}
   */
  set(config) {
    return run(
      "INSERT OR REPLACE INTO settings (user_id, key, value, category) VALUES (NULL, 'sso-config', ?, 'sso')",
      [JSON.stringify(config)]
    );
  },
};

// ─── 2FA-specific helpers ────────────────────────────────────────────────────

const twoFactor = {
  /**
   * Check if 2FA is enabled for a user.
   * @param {number} userId
   * @returns {Promise<boolean>}
   */
  isEnabled(userId) {
    return get(
      "SELECT value FROM settings WHERE user_id = ? AND key = 'two_factor_enabled' AND value = 'true' LIMIT 1",
      [userId]
    ).then(row => !!row);
  },

  /**
   * Get 2FA enrollment info (secret + backup codes) for a user.
   * @param {number} userId
   * @returns {Promise<{secret: string|null, backupCodes: string|null}>}
   */
  getEnrollmentData(userId) {
    return Promise.all([
      get(
        "SELECT value FROM settings WHERE user_id = ? AND key = 'two_factor_secret' LIMIT 1",
        [userId]
      ),
      get(
        "SELECT value FROM settings WHERE user_id = ? AND key = 'two_factor_backup_codes' LIMIT 1",
        [userId]
      ),
    ]).then(([secretRow, backupRow]) => ({
      secret: secretRow ? secretRow.value : null,
      backupCodes: backupRow ? backupRow.value : null,
    }));
  },

  /**
   * Get user 2FA status with user info (for admin views).
   * @param {number} userId
   * @returns {Promise<object|null>}
   */
  getUserStatus(userId) {
    return get(
      `SELECT u.id, u.name, u.email, u.role
       FROM users u WHERE u.id = ?`,
      [userId]
    ).then(user => {
      if (!user) return null;
      return this.getEnrollmentData(userId).then(settings => ({
        ...user,
        twoFactorEnabled: !!settings.secret,
        hasBackupCodes: !!settings.backupCodes,
      }));
    });
  },

  /**
   * Get all users with their 2FA status (for admin enforcement page).
   * @returns {Promise<object[]>}
   */
  getAllUserStatus() {
    return all(
      `SELECT u.id, u.name, u.email, u.role,
              s.value as two_factor_enabled
       FROM users u
       LEFT JOIN settings s ON s.user_id = u.id AND s.key = 'two_factor_enabled'
       ORDER BY u.name ASC`
    );
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  initialize,
  get,
  all,
  run,
  users,
  settings,
  activityLog,
  authSessions,
  ssoConfig,
  twoFactor,
};
