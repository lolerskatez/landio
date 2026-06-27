const jwt = require('jsonwebtoken');

// JWT secret — crash at startup if not set
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required.');
  process.exit(1);
}

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT verification failed:', err.message);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    console.log('JWT verified for user:', user.id, 'email:', user.email);

    // CRITICAL: Verify user still exists in database
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

        console.log('User found in database:', dbUser.email, 'is_active:', dbUser.is_active);

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
            console.log('IP whitelist check: enabled =', ipWhitelistEnabled);

            if (ipWhitelistEnabled) {
              global.db.get(
                'SELECT value FROM settings WHERE key = ? AND user_id IS NULL',
                ['allowed-ips'],
                (err, ipsRow) => {
                  if (!ipsRow) {
                    // No IPs configured, allow all
                    console.log('No IPs configured, allowing access');
                    req.user = user;
                    return next();
                  }

                  const allowedIPs = ipsRow.value.split(',').map(ip => ip.trim());
                  const clientIP = req.ip || req.connection.remoteAddress;

                  console.log('Checking IP:', clientIP, 'against whitelist:', allowedIPs);

                  // Check if IP matches or is in CIDR range
                  const ipMatches = allowedIPs.some(allowedIP => {
                    // Simple check: exact match or CIDR parsing
                    if (allowedIP.includes('/')) {
                      // CIDR notation - simplified check
                      const [network] = allowedIP.split('/');
                      // For production, use ipaddr.js or similar library
                      return clientIP.includes(network.split('.').slice(0, 3).join('.'));
                    }
                    return clientIP === allowedIP;
                  });

                  if (!ipMatches) {
                    console.warn(`IP whitelist blocked access from ${clientIP}, allowed:`, allowedIPs);
                    return res.status(403).json({ error: 'Access denied: IP not whitelisted' });
                  }

                  console.log('IP whitelist passed for:', clientIP);
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
  const token = authHeader && authHeader.split(' ')[1];

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
              console.warn(`2FA enrollment token validation failed: user ${user.id} not found`);
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

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Middleware to check admin or power user role
const requireAdminOrPowerUser = (req, res, next) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'poweruser')) {
    return res.status(403).json({ error: 'Admin or Power User access required' });
  }
  next();
};

module.exports = {
  authenticateToken,
  authenticateFor2FAEnrollment,
  requireAdmin,
  requireAdminOrPowerUser,
  JWT_SECRET
};
