const sqlite3 = require('sqlite3').verbose();

// Add settings table to existing database
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

db.serialize(() => {
  console.log('Adding settings table...');

  // Settings table - stores both system-wide and user-specific settings
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, key),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error('Error creating settings table:', err);
      process.exit(1);
    } else {
      console.log('✓ Settings table created successfully');
    }
  });

  // Create index for faster lookups
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_settings_user_key ON settings(user_id, key)
  `, (err) => {
    if (err) {
      console.error('Error creating index:', err);
    } else {
      console.log('✓ Settings index created');
    }
  });

  // Insert default system settings (user_id = NULL for system-wide settings)
  const defaultSettings = [
    { key: 'serverName', value: 'My Awesome Server', category: 'general' },
    { key: 'theme', value: 'anime', category: 'appearance' },
    { key: 'darkMode', value: 'false', category: 'appearance' },
    { key: 'requireLogin', value: 'true', category: 'security' },
    { key: 'autoBackup', value: 'true', category: 'backup' },
    { key: 'cpuThreshold', value: '80', category: 'monitoring' },
    { key: 'memoryThreshold', value: '85', category: 'monitoring' },
    { key: 'diskThreshold', value: '90', category: 'monitoring' },
    { key: 'emailAlerts', value: 'true', category: 'notifications' }
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO settings (user_id, key, value, category)
    VALUES (NULL, ?, ?, ?)
  `);

  defaultSettings.forEach(setting => {
    stmt.run(setting.key, setting.value, setting.category, (err) => {
      if (err) {
        console.error(`Error inserting setting ${setting.key}:`, err);
      } else {
        console.log(`✓ Default setting added: ${setting.key}`);
      }
    });
  });

  stmt.finalize();

  // Close database
  setTimeout(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
        process.exit(1);
      } else {
        console.log('\n✅ Settings table migration complete!');
        console.log('You can now use the settings API endpoints.');
      }
    });
  }, 500);
});
