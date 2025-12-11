# Architecture & Technical Documentation

## System Overview

Landio is a Node.js/Express-based server management dashboard with SQLite database backend, featuring JWT authentication, role-based access control, and comprehensive UI customization.

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend (HTML/CSS/JS)                │
│  index.html  dashboard.html  login.html  settings.html  │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
   ┌────▼────────────┐      ┌────────▼────────────┐
   │   API Client    │      │   Theme Manager     │
   │   (api.js)      │      │   (theme.js)        │
   └────┬────────────┘      └────────────────────┘
        │
        │ HTTP/REST
        │
┌───────▼─────────────────────────────────────────────┐
│           Express Server (server.js)                 │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           Middleware Layer                   │   │
│  │ - Authentication (JWT)                       │   │
│  │ - Session Management                         │   │
│  │ - CORS & Security                            │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           Route Handlers                     │   │
│  │ - /api/auth (Authentication)                 │   │
│  │ - /api/2fa (Two-Factor Auth)                 │   │
│  │ - /api/users (User Management)               │   │
│  │ - /api/settings (Settings & Preferences)     │   │
│  │ - /api/services (Service Management)         │   │
│  │ - /api/notifications (Alerts)                │   │
│  │ - /api/logs (System Logs)                    │   │
│  └──────────────────────────────────────────────┘   │
└───────┬──────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────┐
│      SQLite Database (database.db)           │
│                                              │
│  Tables:                                     │
│  - users (id, username, email, password)     │
│  - settings (user_id, key, value, category)  │
│  - logs (id, user_id, action, timestamp)     │
│  - sessions (id, user_id, token, expires)    │
└──────────────────────────────────────────────┘
```

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'standard',
  enabled BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Settings Table
```sql
CREATE TABLE settings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  key TEXT NOT NULL,
  value TEXT,
  category TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Logs Table
```sql
CREATE TABLE logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## Authentication Flow

### Login Flow
```
User Input (login.html)
    ↓
POST /api/auth/login
    ↓
[Authenticate Route Handler]
    ├─ Hash password check (bcryptjs)
    ├─ Check if 2FA enabled
    └─ Return JWT or requiresTwoFactor
         │
         ├─ No 2FA: Full JWT token → Dashboard
         └─ 2FA Required:
              ├─ Temporary token (5 min)
              ├─ 2FA PIN screen
              ↓
              POST /api/2fa/verify-login
                ├─ Verify TOTP code
                └─ Return full JWT
```

### JWT Token Structure
```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@example.com",
  "role": "admin",
  "iat": 1702320000,
  "exp": 1702406400
}
```

## Two-Factor Authentication (2FA)

### Setup Flow
```
User navigates to 2FA setup (onboarding.html)
    ↓
POST /api/2fa/setup
    ├─ Generate secret (speakeasy)
    ├─ Create QR code (qrcode library)
    └─ Return data URL image
         │
         ↓
User scans QR code with authenticator app
         │
         ↓
POST /api/2fa/verify
    ├─ Verify 6-digit code against secret
    ├─ Generate backup codes
    ├─ Save twoFactorSecret in settings
    ├─ Save twoFactorBackupCodes in settings
    └─ Mark twofa_enabled = true
         │
         ↓
Display backup codes to user
         │
         ↓
Redirect to dashboard
```

### Login with 2FA
```
User enters credentials
    ↓
POST /api/auth/login
    ├─ Check twofa_enabled = true
    └─ Return requiresTwoFactor: true
         │
         ↓
Show 2FA PIN screen
    ├─ User enters 6-digit code
    │  OR
    ├─ User enters backup code
         │
         ↓
POST /api/2fa/verify-login
    ├─ Query settings table for twofa_secret
    ├─ Verify TOTP code (window: 2 = ±60 seconds)
    │  OR
    ├─ Check backup codes if using backup
    └─ Return full JWT token
         │
         ↓
Redirect to dashboard
```

### Backup Codes
- 10 backup codes generated during setup
- Each code is single-use
- Stored in settings table as JSON array
- Can be regenerated by user

## Settings System

### Setting Storage
Settings are stored in a unified table with flexible key-value structure:

```
Table: settings
├─ System Settings (user_id = NULL)
│  ├─ General: serverName, defaultLanguage
│  ├─ Security: requireLogin, twoFactor, maxLoginAttempts
│  ├─ Notifications: emailAlerts, discordEnabled
│  └─ SMTP: smtpServer, smtpPort, smtpUser
│
└─ User Settings (user_id = user.id)
   ├─ Appearance: theme-preference, selected-theme, font-size
   ├─ Accessibility: high-contrast, reduce-motion, animations-enabled
   ├─ 2FA: twofa_enabled, twoFactorSecret, twoFactorBackupCodes
   └─ Preferences: notifications, autoSave
```

### Theme Preferences API
- **Endpoint**: `GET /api/settings/theme/preferences`
- **Response**: User's theme preferences from database
- **Sync**: Preferences sync from localStorage to server on changes
- **Persistence**: Survives cookie/localStorage clearing

## Theme System

### Architecture
```
theme.js
├─ ThemeManager class
│  ├─ loadFromServer() - Load preferences from DB on init
│  ├─ setTheme() - Change theme
│  ├─ toggleDarkMode() - Toggle dark/light
│  ├─ setFontSize() - Change font size
│  ├─ toggleHighContrast() - Enable/disable high contrast
│  ├─ toggleAnimations() - Enable/disable animations
│  ├─ toggleReduceMotion() - Enable/disable motion reduction
│  ├─ saveToServer() - Async save to DB
│  ├─ syncToLocalStorage() - Sync to browser storage
│  └─ applyTheme() - Apply CSS classes to DOM
│
└─ CSS Classes
   ├─ theme-pastel, theme-cyber, theme-mocha, etc.
   ├─ dark-mode
   ├─ font-small, font-medium, font-large, font-extra-large
   ├─ high-contrast
   ├─ reduce-motion
   └─ animations-enabled
```

### Theme Persistence Flow
```
Page Load
    ↓
theme.js initializes
    ├─ Read localStorage (fallback)
    ├─ Fetch from /api/settings/theme/preferences
    ├─ Apply CSS classes
    └─ applyTheme() renders

User Changes Theme
    ↓
ThemeManager.setTheme(newTheme)
    ├─ Update object properties
    ├─ applyTheme() - Apply CSS immediately
    ├─ syncToLocalStorage() - Save to browser
    ├─ saveToServer() - Async save to DB (non-blocking)
    └─ User sees change instantly

Browser Cleared/New Session
    ↓
Page Load
    ├─ localStorage empty
    ├─ Fetch /api/settings/theme/preferences from DB
    ├─ Restore preferences
    └─ Apply theme
```

## Role-Based Access Control (RBAC)

### Admin Privileges
- Full access to all endpoints
- User management (create, edit, delete)
- System settings configuration
- Log viewing (all users)
- Service management
- Notification settings

### Standard User Privileges
- View own dashboard
- Manage own settings
- View own 2FA status
- View own logs only
- Cannot access admin endpoints

### Middleware Protection
```javascript
// Admin-only routes use requireAdmin middleware
router.delete('/users/:id', authenticateToken, requireAdmin, ...)

// User-only routes use authenticateToken
router.get('/profile', authenticateToken, ...)
```

## File Structure

```
landio/
├── server.js                 # Main Express server
├── package.json              # Dependencies
├── database.db               # SQLite database (created on init)
│
├── frontend/
│   ├── index.html            # Admin dashboard
│   ├── dashboard.html        # User dashboard
│   ├── login.html            # Login page
│   ├── onboarding.html       # 2FA enrollment
│   ├── settings.html         # Settings page
│   ├── setup.html            # Initial setup
│   ├── logs.html             # Logs viewer
│   ├── manage-services.html  # Service management
│   ├── 404.html, 500.html    # Error pages
│   ├── theme.js              # Theme manager
│   ├── base.js               # Base utilities & modals
│   ├── nav.js                # Navigation
│   ├── api.js                # API client
│   └── favicon.svg
│
├── routes/
│   ├── auth.js               # /api/auth/* endpoints
│   ├── 2fa.js                # /api/2fa/* endpoints
│   ├── users.js              # /api/users/* endpoints
│   ├── settings.js           # /api/settings/* endpoints
│   ├── services.js           # /api/services/* endpoints
│   ├── notifications.js      # /api/notifications/* endpoints
│   └── sso.js                # SSO integration (optional)
│
└── scripts/
    └── init-db.js            # Database initialization
```

## Security Considerations

### Password Security
- Bcrypt hashing (10 rounds)
- Minimum 6 characters required
- Changed password invalidates existing sessions

### JWT Security
- Secret key should be strong and unique
- Token expiry: 24 hours
- Refresh token mechanism for extended sessions
- Tokens stored in httpOnly cookies (frontend uses sessionStorage)

### 2FA Security
- TOTP code window: ±60 seconds (2 time windows)
- Backup codes are non-repeating
- 2FA state stored as boolean flag
- Secret securely hashed before storage

### Input Validation
- All user inputs validated on backend
- SQL injection protection via parameterized queries
- XSS protection via DOM manipulation safeguards

## Deployment Notes

### Production Checklist
1. Set `NODE_ENV=production`
2. Change `JWT_SECRET` to strong random value
3. Configure HTTPS/SSL
4. Set up database backups
5. Configure firewall rules
6. Enable logging and monitoring
7. Update admin credentials
8. Test 2FA setup
9. Configure SMTP for email alerts

### Performance Optimization
- Database queries use indexes
- JWT tokens cached in client
- Service status cached for 30 seconds
- Theme preferences cached in localStorage

## Troubleshooting Guide

### Database Connection Issues
- Check `database.db` file exists and is readable
- Verify SQLite3 npm package installed
- Check permissions on database file

### 2FA Verification Fails
- Ensure server time is synchronized (NTP)
- Check TOTP code hasn't expired (30 second window)
- Verify twoFactorSecret exists in settings
- Check backup codes format (JSON array)

### Theme Not Persisting
- Verify API endpoint working: `/api/settings/theme/preferences`
- Check user is authenticated
- Confirm localStorage sync working
- Inspect network tab for POST failures

### Login Issues
- Check user account enabled status
- Verify password hash matches
- Clear session/cookies
- Check JWT token expiry
- Verify 2FA requirements met

## Future Enhancements

- OAuth2/OIDC authentication
- Advanced service monitoring with metrics
- Email-based user invitations
- Audit trail with detailed change tracking
- API key management for external integrations
- Webhook support for custom notifications
- Database replication for high availability
