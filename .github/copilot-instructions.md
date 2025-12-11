# Landio AI Coding Agent Instructions

## Project Overview
Landio is a Node.js/Express-based server management dashboard with dual interfaces (admin/user dashboards), role-based access control, 2FA authentication, and comprehensive settings management. Database: SQLite.

## Architecture

### Three-Layer Pattern
1. **Backend (Node.js/Express)**: `server.js` + routes in `/routes`
2. **Frontend (Vanilla JS)**: HTML pages + utility scripts (`api.js`, `auth.js`, `base.js`, `nav.js`, `theme.js`)
3. **Database (SQLite)**: Schema defined in `scripts/init-db.js`, accessed via `sqlite3` npm package

### Critical Data Flow
- **Authentication**: User → `/api/auth/login` → JWT token stored in `localStorage.authToken`
- **2FA**: POST `/api/2fa/verify-login` with TOTP code → Full JWT returned
- **API Calls**: Client uses `ApiClient` (in `api.js`) with auto-refresh of expired tokens
- **Authorization**: Middleware `authenticateToken()` in routes validates JWT + optional IP whitelist

### Core Routes & Responsibilities
| Path | File | Purpose |
|------|------|---------|
| `/api/auth/*` | `routes/auth.js` | Login, logout, token refresh |
| `/api/2fa/*` | `routes/2fa.js` | 2FA setup, verification, backup codes |
| `/api/users/*` | `routes/users.js` | User CRUD, enable/disable |
| `/api/settings/*` | `routes/settings.js` | User & system settings persistence |
| `/api/services/*` | `routes/services.js` | Service monitoring (start/stop) |
| `/api/notifications/*` | `routes/notifications.js` | Email/Discord alerts |
| `/api/sso/*` | `routes/sso.js` | Authentik SSO integration |

## Key Patterns & Conventions

### JWT & Authentication
- **JWT Secret**: `process.env.JWT_SECRET` (fallback: hardcoded in `routes/auth.js`)
- **Token Payload**: `{ id, username, email, role, iat, exp }`
- **Roles**: `'admin'` or `'standard'` (see `auth.js` for role permissions)
- **Auto-refresh**: ApiClient polls `/api/auth/refresh` before token expiry
- **CRITICAL: User Database Validation**: `authenticateToken()` middleware MUST verify user exists in DB after verifying JWT signature. JWTs can persist in browser storage across redeployments/database resets - only DB lookup confirms user still exists and is active. Check `is_active` flag and return 403 if user not found (see `routes/auth.js` lines 11-80).

### Database Access
- **Pattern**: `global.db.get()` / `db.run()` / `db.all()` (callback-based, not promises)
- **Settings Storage**: `settings` table with `(user_id, key, value, category)` structure
  - `user_id IS NULL` = system-level settings
  - Used for: 2FA secret, UI preferences, SMTP config, IP whitelist
- **Key Settings Examples**:
  - `ip-whitelist` (bool) + `allowed-ips` (CSV)
  - `twoFactorSecret` per user
  - Theme: `theme`, `theme-accent-color`, `border-radius`

### Frontend Architecture
- **Pages**: HTML files load scripts in order: `api.js` → `auth.js` → `base.js` → page-specific script
- **Security**: CSP headers via Helmet; API tokens in Authorization header only
- **UI State**: Managed via `PAGE_CONFIG` object in `base.js` for role-based navigation
- **Theme**: Dynamic CSS via `theme.js`, settings stored per-user

### Error Handling
- **API Responses**: HTTP status + JSON `{ error: "message" }` or `{ data: ... }`
- **2FA Verification Failure**: Returns `requiresTwoFactor: true` with temporary token (5-min expiry)
- **IP Whitelist**: 403 Forbidden with message `"Access denied: IP not whitelisted"`

## Development Workflows

### Database Setup
```bash
npm run init-db  # Creates database.db with schema (runs scripts/init-db.js)
```

### Running Locally
```bash
npm install       # Install dependencies
npm run init-db   # Initialize SQLite database
npm run dev       # Start with nodemon (auto-reload on file changes)
npm start         # Production start
```

### Testing Authentication Locally
1. Navigate to `/setup.html` (OOBE - Out-of-Box Experience)
2. Create first admin account
3. Enable 2FA (optional but recommended)
4. Login at `/login.html` → redirects to `/index.html` (admin) or `/dashboard.html` (user)

## Important Implementation Details

### Rate Limiting
- **API endpoints**: 100 requests/15 min (strict)
- **Static files**: 1000 requests/15 min (lenient) - `staticLimiter` skips `.js`, `.css`, `.html`, `.json`
- **Configured in** `server.js` with separate limiters for different use cases

### 2FA Backup Codes
- Generated when 2FA enabled: stored as JSON in settings
- User can regenerate anytime via `/api/2fa/regenerate-backup-codes`
- Each backup code is one-time use

### Session Management
- Express session via SQLite sessions table
- Session secret: `process.env.SESSION_SECRET` (fallback in `server.js`)
- Cookie-based tracking alongside JWT for redundancy

### Notification System
- Email via Nodemailer (SMTP config stored in settings)
- Discord via webhooks (webhook URL stored in settings)
- Routed through `/api/notifications/*` → `routes/notifications.js`

## Common Modifications

### Adding a New Setting
1. Define in frontend code with key name (e.g., `'new-setting'`)
2. Read/write via `POST /api/settings/` endpoint
3. For system-level: insert with `user_id IS NULL`
4. Load on page init via `base.js` initialization flow

### Adding an Admin-Only Feature
1. Create route in `/routes/` directory
2. Use `authenticateToken` middleware + check `req.user.role === 'admin'`
3. Register route in `server.js` with pattern `/api/your-feature/*`
4. Frontend: Gate UI behind `isAdmin()` check in `auth.js`

### Database Schema Changes
1. Modify `scripts/init-db.js`
2. Add migration logic for existing installations (ALTER TABLE in separate `db.run()`)
3. Run `npm run init-db` in development
4. Document in ARCHITECTURE.md

## Security Considerations
- **CORS**: Limited to localhost origins (see `server.js`)
- **Helmet CSP**: Restricts script sources; unsafe-inline only for styles
- **Bcryptjs**: All passwords hashed before storage
- **SQL Injection**: Parameterized queries via sqlite3 callback style (`?` placeholders)
- **IP Whitelist**: Optional per-user security layer; checked in auth middleware

## External Dependencies
- `speakeasy` + `qrcode`: 2FA TOTP generation & QR codes
- `bcryptjs`: Password hashing
- `jsonwebtoken`: JWT signing/verification
- `openid-client`: Authentik SSO client
- `nodemailer`: Email notifications
- `express-rate-limit`, `helmet`, `cors`: Security

## Debugging Tips
- **Check logs**: Activity logged in `activity_log` table
- **JWT expiry**: Default 24hr; adjust in `routes/auth.js` if needed
- **2FA issues**: Verify secret stored in `settings` table with `key='twoFactorSecret'`
- **CORS errors**: Check origin against `CORS` config in `server.js`

## Theme System Architecture

### Structure
The theme system in `theme.js` is a global `ThemeManager` class that handles:
- **6 theme options**: pastel, cyber, mocha, ice, nature, sunset (applied via `theme-{name}` CSS classes)
- **Dark mode toggle**: `isDarkMode` boolean stored in `localStorage` + server
- **Accessibility settings**: Font size (small/medium/large/extra-large), high contrast, reduce motion
- **Animations control**: Independent toggle for animations + respects `reduce-motion`

### Data Flow
1. **On page load**: `ThemeManager` loads from `localStorage`, then attempts to fetch from `/api/settings/theme/preferences`
2. **User changes theme**: Calls `setTheme()`, `toggleDarkMode()`, etc. → applies CSS classes → saves to localStorage → async POST to server
3. **Fallback behavior**: If server save fails, preferences remain in localStorage (non-blocking)
4. **Settings sync**: `syncFromSettings()` merges theme prefs from settings page form

### Implementation Pattern
```javascript
const themeManager = new ThemeManager();
themeManager.setTheme('cyber');           // Updates localStorage + server
themeManager.toggleDarkMode(true);        // Single source of truth: CSS classes
document.body.classList.contains('dark-mode'); // Check current state
```

### CSS Classes Applied
- `theme-{name}`: Theme color scheme
- `dark-mode`: Dark variant
- `font-{size}`: Font scaling
- `high-contrast`: Enhanced contrast
- `reduce-motion`: Disables animations
- `animations-enabled`: Animations active (inverted by reduce-motion)

### Available Themes
The theme system currently supports:
1. **Pastel (Original/Default)**: Pink anime-inspired with gradient background (`ffd1dc` → `c9e9ff`)
2. **Cyber Sakura**: Dark neon theme with pink accents (`#0E0A1F` background, `#FF5FA2` primary)
3. **Sunset Gradient**: Orange-to-purple warm theme (`#FF6A3D` primary)

To add a new theme:
1. Add `<option value="theme-name">Label</option>` to settings.html theme selector
2. Define `body.theme-theme-name` CSS variables in both `index.html` and `settings.html`
3. Add theme-specific component styling (headers, buttons, inputs, cards, modals)
4. Theme manager automatically applies the class on selection

## Authentik SSO Integration

### Configuration Flow
1. **Load from settings**: SSO config stored in `settings` table (system-level, `user_id IS NULL`)
2. **Configure OIDC client**: POST `/api/sso/config` with issuer URL, client ID, secret → discovers OIDC endpoints via `openid-client`
3. **Validation**: Issuer discovery must succeed or config rejected with 400 error

### Login Flow
```
GET /api/sso/login
  ├─ Generates code_verifier + code_challenge (PKCE)
  ├─ Redirects to issuer's authorization endpoint
  └─ State token stored in session for verification

User authenticates at issuer
  │
  └─ Redirects to /api/sso/callback?code=xxx&state=yyy

POST /api/sso/callback
  ├─ Verifies state token matches session
  ├─ Exchanges code for ID token (PKCE validation)
  ├─ Extracts user info: email, name, groups from ID token
  ├─ Upserts user in `users` table (create if not exists)
  ├─ Issues Landio JWT token
  └─ Redirects to dashboard
```

### Key Details
- **PKCE enabled**: Code verifier stored in `codeVerifier` variable (in-memory, not session)
- **State verification**: CSRF protection via state token matching
- **User mapping**: Email from OIDC claim maps to `users.email`; groups stored as JSON in `groups` field
- **Auto-enrollment**: New users auto-created with role based on group membership or default 'standard'

## Common Bugs & Patterns to Avoid

### 1. **Callback vs Promise Mixing**
Routes use callback-based `global.db.get()` / `db.run()`, NOT promises. DO NOT use `.then()` on database calls.
```javascript
// ✓ CORRECT
global.db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row);
});

// ✗ WRONG - will crash
const user = await global.db.get('SELECT * FROM users WHERE id = ?', [id]);
```

### 2. **Async Route Handlers with Callbacks**
Many routes use `async (req, res) =>` but return results via callbacks inside. Don't `await` the callback:
```javascript
// ✓ CORRECT - callback handles response
router.post('/endpoint', async (req, res) => {
    const qrCode = await QRCode.toDataURL(url);  // OK to await external libs
    global.db.run(query, params, (err) => {       // No await here
        res.json({ data });
    });
});
```

### 3. **Token Refresh Race Condition**
`api.js` has `refreshQueue` to prevent multiple simultaneous token refresh attempts. Always use:
```javascript
const api = new ApiClient();
await api.refreshTokenIfNeeded();  // Won't duplicate refresh requests
```

### 4. **Settings Scope Confusion**
Settings with `user_id IS NULL` are system-wide; otherwise user-specific. When reading:
```javascript
// First check user setting, then fall back to system
const setting = getUserSetting(userId, key) || getSystemSetting(key);
```

### 5. **2FA Window Parameter**
TOTP verification uses `window: 2` (allows ±30 seconds of drift). Ensure device clocks are synchronized:
```javascript
speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: code,
    window: 2  // Critical for time-based codes
});
```

### 6. **Role-Based Access Checks**
Must check both in backend middleware AND frontend UI gate:
```javascript
// Backend: authenticate + verify role
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
    next();
};

// Frontend: hide UI for non-admins
if (isAdmin()) { /* show admin buttons */ }
```

### 7. **HTML Load Order Dependency**
Frontend scripts load in strict order: `api.js` → `auth.js` → `base.js` → page-specific. Don't reverse this or global state won't initialize properly.

### 8. **localStorage Persistence Across Logout**
Clearing auth token doesn't auto-clear other localStorage keys (theme, user prefs). Explicitly clear sensitive keys on logout:
```javascript
localStorage.removeItem('authToken');
localStorage.removeItem('currentUser');  // Don't leave user data after logout
```

### 9. **JWT Token Validation After Redeployment**
JWT tokens persist in browser storage even after database resets. After redeployment with empty database:
- Old tokens will still be valid cryptographically (same JWT_SECRET)
- But `authenticateToken()` middleware must reject them if user doesn't exist in DB
- Always verify user exists via `global.db.get()` before granting access
- Check both existence AND `is_active` flag
```javascript
// ✓ CORRECT - validates user in DB
global.db.get('SELECT id FROM users WHERE id = ?', [user.id], (err, dbUser) => {
    if (!dbUser) return res.status(403).json({ error: 'User not found' });
    // User exists, proceed
});

// ✗ WRONG - accepts old tokens after database reset
jwt.verify(token, JWT_SECRET, (err, user) => {
    // This is valid cryptographically but user may not exist anymore
    res.json({ data: user });
});
```

## Project Conventions

### File Organization
- **Routes**: Each feature gets its own file (`/routes/*.js`), exported as `module.exports = router`
- **Frontend utilities**: Loaded as global scripts (`api.js`, `auth.js`, `theme.js`, `nav.js`) - NOT modules
- **Settings storage**: Use `settings` table for all user/system preferences; key-value pairs with category field

### Error Response Format
All API errors follow pattern:
```json
{ "error": "human-readable message" }
```
Success responses vary: `{ "data": ... }` or `{ "success": true, ... }`

### Database Null Handling
- `user_id IS NULL` queries for system settings
- Always use parameterized queries: `?` placeholders, pass params as array to callback
- No ORM - raw sqlite3 callbacks throughout

### Frontend Token Management
- **Storage**: `localStorage.authToken` is the source of truth
- **Expiry check**: `ApiClient.refreshTokenIfNeeded()` called before sensitive requests
- **Header format**: `Authorization: Bearer {token}`

### Page Configuration
Each HTML page gets entry in `PAGE_CONFIG` (in `base.js`) with:
- `brand`: Display name in nav
- `icon`: FontAwesome icon name
- `pageType`: 'admin' or 'user' (controls nav items shown)

### Activity Logging
Log user actions to `activity_log` table:
```javascript
global.db.run(
    'INSERT INTO activity_log (user_id, action, ip_address) VALUES (?, ?, ?)',
    [userId, 'login_success', clientIP]
);
```
