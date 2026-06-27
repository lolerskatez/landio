/**
 * Test Helpers — Shared setup for all test files.
 *
 * Creates an in-memory SQLite database, initialises all tables,
 * seeds test users, and returns an Express app ready for supertest.
 *
 * Usage:
 *   const { app, createAuthToken, clearDatabase } = require('./helpers');
 */

const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const datalayer = require('../lib/datalayer');

// ─── Env vars (must be set BEFORE any route module is loaded) ──────────────
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-change-in-production';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-change-in-production';

// ─── Database ──────────────────────────────────────────────────────────────
let _db;

function createDatabase() {
  _db = new sqlite3.Database(':memory:');
  global.db = _db;
  datalayer.initialize(_db);
  return _db;
}

function createTables() {
  return new Promise((resolve, reject) => {
    _db.serialize(() => {
      try {
        // Users table
        _db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            avatar TEXT,
            groups TEXT,
            last_login DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT 1,
            permissions TEXT,
            login_count INTEGER DEFAULT 0,
            last_activity DATETIME,
            onboarding_completed BOOLEAN DEFAULT 0,
            failed_attempts INTEGER DEFAULT 0,
            last_failed_attempt DATETIME,
            locked_until DATETIME,
            username TEXT,
            display_name TEXT,
            sso_provider TEXT,
            sso_id TEXT
          )
        `);

        // Activity log table
        _db.run(`
          CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
          )
        `);

        // Sessions table (for express-session)
        _db.run(`
          CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            sess TEXT NOT NULL,
            expire INTEGER NOT NULL
          )
        `);

        // Settings table
        _db.run(`
          CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            key TEXT NOT NULL,
            value TEXT,
            category TEXT DEFAULT 'general',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, key),
            FOREIGN KEY (user_id) REFERENCES users (id)
          )
        `);

        // Services table
        _db.run(`
          CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            description TEXT,
            icon TEXT,
            custom_icon_path TEXT,
            status TEXT DEFAULT 'online',
            access_level TEXT DEFAULT 'public',
            template_key TEXT,
            health_check_enabled BOOLEAN DEFAULT 1,
            health_check_interval INTEGER DEFAULT 60,
            health_check_timeout INTEGER DEFAULT 5000,
            expected_status_codes TEXT DEFAULT '[200, 301, 302]',
            last_health_check DATETIME,
            last_health_check_result TEXT,
            uptime_total_checks INTEGER DEFAULT 0,
            uptime_successful_checks INTEGER DEFAULT 0,
            uptime_percentage REAL DEFAULT 100,
            average_response_time REAL DEFAULT 0,
            last_downtime DATETIME,
            downtime_duration INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
          )
        `);

        // Auth sessions table
        _db.run(`
          CREATE TABLE IF NOT EXISTS auth_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
          )
        `);

        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

// ─── Seed Data ─────────────────────────────────────────────────────────────

const TEST_ADMIN = {
  name: 'Admin User',
  email: 'admin@test.com',
  password: 'Admin123!',
  username: 'admin',
  display_name: 'Admin',
  role: 'admin',
  groups: JSON.stringify(['admins', 'users']),
  permissions: JSON.stringify({
    canViewServices: true,
    canManageServices: true,
    canManageUsers: true,
    canManageSettings: true,
    canViewLogs: true,
    canManageTwoFA: true
  })
};

const TEST_USER = {
  name: 'Regular User',
  email: 'user@test.com',
  password: 'User1234!',
  username: 'regularuser',
  display_name: 'Regular User',
  role: 'user',
  groups: JSON.stringify(['users']),
  permissions: JSON.stringify({
    canViewServices: true,
    canManageServices: false,
    canManageUsers: false,
    canManageSettings: false,
    canViewLogs: false,
    canManageTwoFA: false
  })
};

async function seedDatabase() {
  const adminHash = await bcrypt.hash(TEST_ADMIN.password, 10);
  const userHash = await bcrypt.hash(TEST_USER.password, 10);

  await datalayer.run(
    `INSERT INTO users (username, name, display_name, email, password_hash, role, avatar, groups, permissions, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [TEST_ADMIN.username, TEST_ADMIN.name, TEST_ADMIN.display_name, TEST_ADMIN.email, adminHash, TEST_ADMIN.role, 'AD', TEST_ADMIN.groups, TEST_ADMIN.permissions, 1]
  );

  await datalayer.run(
    `INSERT INTO users (username, name, display_name, email, password_hash, role, avatar, groups, permissions, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [TEST_USER.username, TEST_USER.name, TEST_USER.display_name, TEST_USER.email, userHash, TEST_USER.role, 'RU', TEST_USER.groups, TEST_USER.permissions, 1]
  );
}

// ─── Express App ───────────────────────────────────────────────────────────

let _app = null;

function createApp() {
  if (_app) return _app;

  const app = express();

  // Minimal middleware (matching server.js but without helmet/cors for tests)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
  }));

  // Mount routes (same paths as server.js)
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/users', require('../routes/users'));
  app.use('/api/settings', require('../routes/settings'));
  app.use('/api/services', require('../routes/services'));
  app.use('/api/2fa', require('../routes/2fa'));
  app.use('/api/sso', require('../routes/sso'));
  app.use('/api/logs', require('../routes/audit'));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), uptime: process.uptime() });
  });

  _app = app;
  return app;
}

// ─── Auth Token Helpers ───────────────────────────────────────────────────

function createAuthToken(userOverrides = {}) {
  const defaults = {
    id: 1,
    username: TEST_ADMIN.username,
    name: TEST_ADMIN.name,
    displayName: TEST_ADMIN.display_name,
    email: TEST_ADMIN.email,
    role: TEST_ADMIN.role,
    avatar: 'AD'
  };
  const payload = { ...defaults, ...userOverrides };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Database Cleanup ─────────────────────────────────────────────────────

async function clearDatabase() {
  await datalayer.run('DELETE FROM activity_log');
  await datalayer.run('DELETE FROM settings');
  await datalayer.run('DELETE FROM services');
  await datalayer.run('DELETE FROM auth_sessions');
  await datalayer.run('DELETE FROM users');
}

async function closeDatabase() {
  if (_db) {
    await new Promise((resolve) => _db.close(resolve));
    _db = null;
    global.db = null;
  }
}

// ─── Full Setup / Teardown ────────────────────────────────────────────────

async function setupTestEnvironment() {
  createDatabase();
  await createTables();
  await seedDatabase();
  const app = createApp();
  return { app, createAuthToken, authHeader, clearDatabase };
}

async function teardownTestEnvironment() {
  try {
    await clearDatabase();
  } catch (e) {
    // Ignore cleanup errors
  }
  await closeDatabase();
}

module.exports = {
  setupTestEnvironment,
  teardownTestEnvironment,
  createAuthToken,
  authHeader,
  clearDatabase,
  TEST_ADMIN,
  TEST_USER,
};
