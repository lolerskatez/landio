const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const ssoRoutes = require('./routes/sso');
const tfaRoutes = require('./routes/2fa');
const servicesRoutes = require('./routes/services');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for Cloudflare tunnels and other reverse proxies
app.set('trust proxy', 1);

// Security middleware - configured for both direct access and reverse proxy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://static.cloudflareinsights.com"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://static.cloudflareinsights.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  // Disable strict transport security - let reverse proxy handle HTTPS
  strictTransportSecurity: false,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// More lenient limiter for static files and HTML pages
const staticLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // much higher limit for static files
  skip: (req) => {
    // Skip rate limiting for static files
    return req.path.endsWith('.js') || 
           req.path.endsWith('.css') || 
           req.path.endsWith('.html') || 
           req.path.endsWith('.svg') ||
           req.path.endsWith('.ico') ||
           req.path.endsWith('.json');
  }
});

// Stricter limiter for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit API requests
  message: 'Too many requests from this IP, please try again later.'
});

app.use(staticLimiter);

// CORS configuration - allows local development and reverse proxy
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or same-origin)
    if (!origin) return callback(null, true);
    
    // Allow localhost on any port
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    
    // Allow local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x) on any port
    if (/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)\d+\.\d+(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    
    // Allow any origin when behind reverse proxy (for production deployments)
    // The reverse proxy should handle origin validation
    if (process.env.ALLOW_ALL_ORIGINS === 'true') {
      return callback(null, true);
    }
    
    // Reject all other origins
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Serve static files from the root directory (for the frontend)
app.use(express.static(path.join(__dirname)));

// API routes with stricter rate limiting
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/users', apiLimiter, userRoutes);
app.use('/api/settings', apiLimiter, settingsRoutes);
app.use('/api/services', apiLimiter, servicesRoutes);
app.use('/api/2fa', apiLimiter, tfaRoutes);
app.use('/api/sso', ssoRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Favicon route - serve SVG favicon instead of .ico
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.sendFile(path.join(__dirname, 'favicon.svg'));
});

// Catch-all handler: send back index.html for client-side routing
app.get('*', (req, res) => {
  // Only serve HTML files for known routes, otherwise serve index.html
  const htmlRoutes = ['/login', '/dashboard', '/settings', '/logs'];
  const isHtmlRoute = htmlRoutes.some(route => req.path.startsWith(route)) ||
                     req.path.endsWith('.html') ||
                     req.path === '/';

  if (isHtmlRoute) {
    // Try to serve the specific HTML file, fallback to index.html
    const filePath = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '') + (req.path.endsWith('.html') ? '' : '.html');
    const fullPath = path.join(__dirname, filePath);

    res.sendFile(fullPath, (err) => {
      if (err) {
        // If specific file doesn't exist, serve index.html
        res.sendFile(path.join(__dirname, 'index.html'));
      }
    });
  } else {
    // For API routes or other requests, return 404
    res.status(404).json({ error: 'Not found' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Initialize database
const dbPath = process.env.DATABASE_PATH || './database.db';
global.db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

// Create tables if they don't exist
global.db.serialize(() => {
  // Users table
  global.db.run(`
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
      onboarding_completed BOOLEAN DEFAULT 0
    )
  `, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
    }
  });

  // Add onboarding_completed column to existing users table if it doesn't exist
  global.db.run(`
    ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN DEFAULT 0;
  `, (err) => {
    // It's OK if this fails (column might already exist)
    if (err && !err.message.includes('duplicate column name')) {
      // Silently fail - column might already exist
    }
  });

  // Add failed_attempts column for account lockout tracking
  global.db.run(`
    ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0;
  `, (err) => {
    // It's OK if this fails (column might already exist)
    if (err && !err.message.includes('duplicate column name')) {
      // Silently fail - column might already exist
    }
  });

  // Add last_failed_attempt column for account lockout tracking
  global.db.run(`
    ALTER TABLE users ADD COLUMN last_failed_attempt DATETIME;
  `, (err) => {
    // It's OK if this fails (column might already exist)
    if (err && !err.message.includes('duplicate column name')) {
      // Silently fail - column might already exist
    }
  });

  // Activity log table
  global.db.run(`
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
    }
  });

  // Sessions table
  global.db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating sessions table:', err);
    }
  });

  // Settings table for user and system settings
  global.db.run(`
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
  `, (err) => {
    if (err) {
      console.error('Error creating settings table:', err);
    }
  });

  // Services table
  global.db.run(`
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
  `, (err) => {
    if (err) {
      console.error('Error creating services table:', err);
    }
  });
});

// Test database connection
global.db.get('SELECT 1', (err, row) => {
  if (err) {
    console.error('Database test query failed:', err);
    process.exit(1);
  }
  console.log('Database connection test successful');
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Initialize database and start server
console.log('Database initialized successfully.');

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  
  // Send app stop notification
  try {
    const { sendNotification } = require('./routes/notifications');
    await sendNotification('app-stop', {
      message: 'Landio Dashboard application is stopping',
      reason: 'SIGINT received'
    });
  } catch (err) {
    console.error('App stop notification error:', err);
  }
  
  process.exit(0);
});

// Error notifications
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  
  try {
    const { sendNotification } = require('./routes/notifications');
    await sendNotification('errors', {
      error: error.message,
      stack: error.stack,
      type: 'uncaughtException'
    });
  } catch (err) {
    console.error('Error notification failed:', err);
  }
  
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  try {
    const { sendNotification } = require('./routes/notifications');
    await sendNotification('errors', {
      reason: reason,
      type: 'unhandledRejection'
    });
  } catch (err) {
    console.error('Error notification failed:', err);
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Frontend served from: http://localhost:${PORT}`);
  console.log(`API endpoints available at: http://localhost:${PORT}`);
  console.log(`API endpoints available at: http://localhost:${PORT}/api`);

  // Load SSO configuration from database
  try {
    await ssoRoutes.loadSSOConfig();
  } catch (err) {
    console.error('Failed to load SSO config on startup:', err);
  }

  // Send app start notification
  const { sendNotification } = require('./routes/notifications');
  sendNotification('app-start', {
    message: 'Landio Dashboard application has started successfully',
    port: PORT
  }).catch(err => console.error('App start notification error:', err));
}).on('error', (err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});