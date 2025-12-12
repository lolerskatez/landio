const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

// Initialize database
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

// Create tables
db.serialize(() => {
  console.log('Creating tables...');

  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      name TEXT NOT NULL,
      display_name TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      avatar TEXT,
      groups TEXT, -- JSON array
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active BOOLEAN DEFAULT 1,
      permissions TEXT, -- JSON object
      login_count INTEGER DEFAULT 0,
      last_activity DATETIME,
      onboarding_completed BOOLEAN DEFAULT 0,
      sso_provider TEXT,
      sso_id TEXT UNIQUE
    )
  `, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
    } else {
      console.log('✓ Users table created');
    }
  });

  // Sessions table for session management
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating sessions table:', err);
    } else {
      console.log('✓ Sessions table created');
    }
  });

  // Activity log table
  db.run(`
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
  `, (err) => {
    if (err) {
      console.error('Error creating activity_log table:', err);
    } else {
      console.log('✓ Activity log table created');
    }
  });

  // Add missing columns to existing users table
  const columnsToAdd = [
    { name: 'onboarding_completed', type: 'BOOLEAN DEFAULT 0' },
    { name: 'username', type: 'TEXT UNIQUE' },
    { name: 'display_name', type: 'TEXT' },
    { name: 'sso_provider', type: 'TEXT' },
    { name: 'sso_id', type: 'TEXT UNIQUE' }
  ];

  columnsToAdd.forEach(col => {
    db.run(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type};`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.warn(`Note: Could not add ${col.name} column (may already exist):`, err.message);
      } else if (!err) {
        console.log(`✓ Added ${col.name} column`);
      }
    });
  });

  // Close database after tables are created
  setTimeout(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database initialization complete!');
        console.log('No demo users created. Use the setup page to create the first admin account.');
      }
    });
  }, 500);
});

// No demo users - system starts empty and uses setup page for first admin
async function insertDemoUsers() {
  // This function is no longer used
}