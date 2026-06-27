# Landio Project Assessment (v2)

> **Date:** 2026-06-25
> **Scope:** Full codebase assessment covering security, architecture, features, code quality
> **Note:** This is an **update** to the existing [`plans/landio-assessment.md`](plans/landio-assessment.md). Several items from the existing Phase 1-3 plans are already implemented. This document reflects the **actual current state** of the codebase.

---

## Table of Contents

1. [Current State of Existing Plans](#current-state-of-existing-plans)
2. [What's Done Well](#whats-done-well)
3. [What's Missing (Feature Gaps)](#whats-missing-feature-gaps)
4. [What Needs Improvement](#what-needs-improvement)
5. [DEPRECATED Code That Should Be Removed](#deprecated-code-that-should-be-removed)
6. [Updated Phased Recommendations](#updated-phased-recommendations)
7. [Architecture Observations](#architecture-observations)

---

## Current State of Existing Plans

### Phase 1 — Security Hardening

| Item | Status | Notes |
|------|--------|-------|
| 1. Shared middleware module | ✅ **DONE** | [`middleware/auth.js`](middleware/auth.js) already exists with `authenticateToken`, `authenticateFor2FAEnrollment`, `requireAdmin`, `requireAdminOrPowerUser` |
| 2. Remove hardcoded JWT secrets | ⚠️ **Partial** | [`server.js:27-30`](server.js:27-30) validates `JWT_SECRET` at startup, but route files still have dead-code fallbacks (`process.env.JWT_SECRET \|\| 'your-jwt-secret-change-in-production'`) at [`routes/auth.js:8`](routes/auth.js:8), [`routes/users.js:15`](routes/users.js:15) |
| 3. Session cookie `secure` flag | ❌ **Needs work** | [`server.js:140`](server.js:140) still hardcodes `secure: false`. The `.env.example` has `SESSION_SECURE=false` but server.js doesn't read it |
| 4. Standardize 2FA key names | ❌ **Not done** | Inconsistent keys across [`routes/2fa.js`](routes/2fa.js): `twofa_enabled`, `twoFactorEnabled`, `twoFactorSecret`, `twofa_secret`, `twoFactorBackupCodes`, `backup_codes` |
| 5. Remove duplicate 2FA routes | ❌ **Not done** | Duplicate `/setup` and `/generate-secret` endpoints; duplicate `/disable` routes |
| 6. Add login rate limiting | ⚠️ **Partial** | [`routes/auth.js:11-17`](routes/auth.js:11-17) has `loginLimiter` (20/15min) and [`routes/2fa.js:10-16`](routes/2fa.js:10-16) has `twoFALimiter` (10/15min). API-level rate limiting exists via `apiLimiter` at [`server.js:86-90`](server.js:86-90) |
| 7. Fix SSO logout redirect | ❌ **Not done** | [`routes/sso.js`](routes/sso.js) still has hardcoded `up-down.xyz` fallback |

### Phase 2 — Config & Data Protection

| Item | Status | Notes |
|------|--------|-------|
| 1. 2FA backup codes rotation | ❌ **Not done** | No `/regenerate-backup-codes` endpoint; no exhaustion handling |
| 2. Centralized DB access layer | ✅ **DONE** | [`lib/datalayer.js`](lib/datalayer.js) exists with Promise-based wrappers for users, settings, activityLog, authSessions, ssoConfig, twoFactor domains |
| 3. Email notification hardening | ❌ **Not done** | STMP password stored plaintext; `rejectUnauthorized: false` and SSLv3 ciphers still present |

### Phase 3 — Audit & Observability

| Item | Status | Notes |
|------|--------|-------|
| 1. Server-side activity log API | ✅ **DONE** | [`routes/audit.js`](routes/audit.js) has `GET /api/logs` (filtered, paginated), `DELETE /api/logs`, `GET /api/logs/export` (JSON/CSV), `GET /api/logs/stats`. Already imported in [`server.js:21,154`](server.js:21) |
| 2. Rewrite logs.html to use server API | ❌ **Not done** | [`logs.html`](logs.html) still uses `localStorage.getItem('logs')` — completely disconnected from the server's `activity_log` table |
| 3. Pagination for user list | ❌ **Not done** | [`routes/users.js`](routes/users.js) GET / still returns all users at once |
| 4. Last admin guard | ❌ **Not done** | No check preventing deletion of the only admin account |
| 5. Error response hardening | ❌ **Not done** | Some routes still leak `err.message` to clients |
| 6. Migrate routes to datalayer | ⚠️ **Partial** | auth.js and 2fa.js use datalayer; users.js and sso.js still use raw `global.db.run()` |

---

## What's Done Well

### Architecture & Code Organization

- **Clean module separation** — Route files by domain (`routes/auth.js`, `routes/2fa.js`, `routes/users.js`, `routes/settings.js`, `routes/services.js`, `routes/notifications.js`, `routes/sso.js`, `routes/audit.js`)
- **Centralized data layer** — [`lib/datalayer.js`](lib/datalayer.js) provides Promise-based DB access with domain-specific methods (users, settings, activityLog, etc.). Well-architected for testability.
- **Shared middleware** — [`middleware/auth.js`](middleware/auth.js) provides JWT verification, 2FA enrollment auth, and role checking from a single source
- **Server validates critical secrets at startup** — [`server.js:27-34`](server.js:27-34) exits with clear error if `JWT_SECRET` or `SESSION_SECRET` are missing
- **Server-side audit API already built** — [`routes/audit.js`](routes/audit.js) is production-ready with filtering, pagination, export, and stats

### Security Features

- **Comprehensive stack**: Helmet headers, CORS validation, rate limiting (login, 2FA, API), bcrypt password hashing, JWT tokens
- **2FA system**: TOTP (speakeasy), QR code setup, 10 single-use backup codes, admin enforcement with grace periods
- **Account lockout**: Configurable max attempts and lockout duration
- **Password policy**: Min 8 chars, uppercase, lowercase, numbers, special characters
- **IP whitelist**: Per-user IP restriction support
- **SSO/OIDC**: OpenID Connect with Authentik support, group-to-role mapping
- **Audit logging**: Login, logout, user CRUD, 2FA operations, SSO logins all logged

### Feature Set

- **40+ service templates** for auto-discovery (Nextcloud, Plex, Jellyfin, Portainer, etc.)
- **6 themes** (pastel, cyber, mocha, ice, nature, sunset) with dark mode, high contrast, reduce motion
- **Event-based notifications**: 9 event types via SMTP email and Discord webhooks
- **Docker support**: Multi-stage Alpine build, health checks, dumb-init for signal handling
- **Graceful shutdown**: App-start/app-stop notifications on server lifecycle
- **Role-based access**: admin, poweruser, user with per-service visibility levels

### Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — System architecture with diagrams
- [`README.md`](README.md) — Quick start, feature list, API endpoints, troubleshooting
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Deployment guide
- [`DOCKER.md`](DOCKER.md) — Docker-specific documentation
- [`CHANGELOG.md`](CHANGELOG.md) — Version tracking
- [`.env.example`](.env.example) — Comprehensive environment configuration

---

## What's Missing (Feature Gaps)

### Critical Feature Gaps

| # | Gap | Impact | Details |
|---|-----|--------|---------|
| 1 | **No password reset flow** | High | [`.env.example`](.env.example) declares `ENABLE_PASSWORD_RESET=true` but there's zero implementation. Users who forget passwords must contact an admin |
| 2 | **logs.html disconnected from server** | High | [`logs.html`](logs.html) (1446 lines) uses `localStorage` only — cannot see server-side audit data from `activity_log` table. The server API exists ([`routes/audit.js`](routes/audit.js)) but the frontend doesn't use it |
| 3 | **user-management.html missing** | High | Referenced in [`base.js:29-33`](base.js:29-33) as a valid PAGE_CONFIG page, but the file doesn't exist in the project |
| 4 | **No CSRF protection** | High | No CSRF tokens on any API endpoints. Session cookies are used alongside JWT tokens, creating CSRF vulnerability surface |
| 5 | **No input validation/sanitization** | High | User inputs (names, emails, service URLs, settings values) are not validated or sanitized before storage |

### Medium-Priority Feature Gaps

| # | Gap | Details |
|---|------|---------|
| 6 | **No test infrastructure** | Zero tests — no test framework in [`package.json`](package.json), no test files |
| 7 | **No CI/CD pipeline** | [`.github/`](.github/) directory exists but is empty (no workflow files) |
| 8 | **No WebSocket/real-time updates** | Dashboard relies on manual refresh; service health checks are HTTP polling only |
| 9 | **No automated backup scheduling** | No UI or server-side mechanism for DB backups |
| 10 | **No API versioning** | All endpoints at `/api/*` with no version prefix |
| 11 | **No user self-registration** | Users must be created by admin; no invite system |
| 12 | **No request payload size limiting** | `express.json()` is used without `limit` option — large payloads could be sent |

### Low-Priority Feature Gaps

| # | Gap | Details |
|---|------|---------|
| 13 | **No email templates** | Notification emails use inline HTML strings in [`routes/notifications.js:237-366`](routes/notifications.js:237-366) — no template engine |
| 14 | **No i18n support** | All UI text is hardcoded in English |
| 15 | **No rate limit status headers** | Rate limit headers not configured on limiters |

---

## What Needs Improvement

### 🔴 Critical

| # | Issue | Location | Severity | Details |
|---|-------|----------|----------|---------|
| C1 | **2FA key naming chaos** | [`routes/2fa.js`](routes/2fa.js) throughout | 🔴 | Uses `twofa_enabled`, `twoFactorEnabled`, `twoFactorSecret`, `twofa_secret`, `twoFactorBackupCodes`, `backup_codes` interchangeably across ~15 locations. Data saved under one key may not be found when read under another. **This is a data integrity bug** |
| C2 | **Duplicate 2FA routes** | [`routes/2fa.js:98`](routes/2fa.js:98) and [`routes/2fa.js:254`](routes/2fa.js:254) | 🔴 | Two `/disable` endpoints. The second one (line 254) silently overrides the first. The first is more comprehensive (deletes 3 keys); the second only deletes `twofa_enabled` |
| C3 | **Duplicate 2FA setup endpoints** | [`routes/2fa.js:24`](routes/2fa.js:24) (`/setup`) and [`routes/2fa.js:125`](routes/2fa.js:125) (`/generate-secret`) | 🔴 | Both generate TOTP secret + QR code. `/setup` uses `authenticateFor2FAEnrollment`, `/generate-secret` uses `authenticateToken`. Different auth paths can lead to inconsistent state |
| C4 | **SMTP password stored in plaintext** | [`routes/settings.js`](routes/settings.js) | 🔴 | SMTP password is stored as-is in the settings table. Any user with DB access (or SQL injection) can read it. Also no encoding/obfuscation |
| C5 | **Weak TLS defaults** | [`routes/notifications.js:75-87`](routes/notifications.js:75-87) | 🔴 | `rejectUnauthorized: false` (allows MITM), `ciphers: 'SSLv3'` (deprecated/insecure protocol). Same in [`routes/settings.js:447-459`](routes/settings.js:447-459) |
| C6 | **Hardcoded SSO logout redirect** | [`routes/sso.js`](routes/sso.js) | 🔴 | Falls back to `https://up-down.xyz/` if `BASE_URL` env var not set — a specific third-party domain |
| C7 | **JWT fallbacks still in route files** | [`routes/auth.js:8`](routes/auth.js:8), [`routes/users.js:15`](routes/users.js:15) | 🔴 | `process.env.JWT_SECRET \|\| 'your-jwt-secret-change-in-production'` — dead code since server.js validates at startup, but dangerous if a route file is loaded before server.js validation |
| C8 | **CSP allows unsafe-inline** | [`server.js:42-51`](server.js:42-51) | 🔴 | Both `script-src` and `style-src` use `'unsafe-inline'` and `http:` sources, weakening XSS protection. Likely required because of inline JS/CSS in HTML files |

### 🟠 High

| # | Issue | Location | Details |
|---|-------|----------|---------|
| H1 | **CSS injected via JS (1041 lines)** | [`base.js:151-1192`](base.js:151-1192) | All navigation bar CSS is inline JavaScript string concatenation. Impossible to maintain, override, or use CSS preprocessors with |
| H2 | **Deprecated frontend user database** | [`auth.js:310-425`](auth.js:310-425) | Contains `getUserDatabase()`, `saveUserDatabase()`, `createUser()`, `legacyUpdateUser()`, `legacyDeleteUser()` all using `localStorage`. This is **dead code** that could mislead developers |
| H3 | **Deprecated frontend SSO** | [`auth.js:163-307`](auth.js:163-307) | Hardcoded Authentik SSO with placeholder values (`dummy-client-id`, `dummy-client-secret`, `http://localhost:3001/callback`). This frontend-only OIDC flow should be removed in favor of the server-side SSO in [`routes/sso.js`](routes/sso.js) |
| H4 | **No "last admin" guard** | [`routes/users.js:503-525`](routes/users.js:503-525) | Can delete the last remaining admin account, potentially locking everyone out of the system |
| H5 | **JWT refresh ignores session-timeout** | [`routes/auth.js:571-585`](routes/auth.js:571-585) | `/refresh` always issues 24h tokens regardless of user's configured `session-timeout` setting |
| H6 | **onboarding.html loads QR from CDN** | [`onboarding.html:10`](onboarding.html:10) | Loads `https://cdnjs.cloudflare.com/ajax/libs/qrcode/1.5.3/qrcode.min.js` — external dependency introduces availability risk and supply-chain security concern |
| H7 | **Error responses leak internals** | [`routes/users.js`](routes/users.js), [`routes/2fa.js`](routes/2fa.js) | Some error handlers include `err.message` in JSON responses, leaking internal state (SQL errors, file paths) |
| H8 | **Session secure:false hardcoded** | [`server.js:140`](server.js:140) | Session cookie `secure: false` means cookies are transmitted over HTTP. The env var exists (`SESSION_SECURE`) but server.js doesn't read it |
| H9 | **Nested callbacks (callback hell)** | [`routes/auth.js`](routes/auth.js), [`routes/2fa.js`](routes/2fa.js) | 5-7 levels deep in places. Makes code hard to follow, maintain, and debug. Some of auth.js is still not migrated to async/await |

### 🟡 Medium

| # | Issue | Location | Details |
|---|-------|----------|---------|
| M1 | **No user list pagination** | [`routes/users.js`](routes/users.js) GET / | Returns ALL users at once via `global.db.all()` — problematic for large deployments |
| M2 | **Service health check timeout handling** | [`routes/services.js:503-541`](routes/services.js:503-541) | `http.get()` without proper timeout handling in some code paths |
| M3 | **SQL injection surface** | Various route files | Some queries use string interpolation (`SELECT ... ${variable}`) instead of parameterized queries |
| M4 | **Theme enrollment: 3 separate API calls** | [`base.js:1759-1796`](base.js:1759-1796) | Theme preferences saved via 3 sequential `fetch()` calls instead of batching |
| M5 | **Hardcoded service icon colors** | [`routes/services.js:58-379`](routes/services.js:58-379) | Service template icons use hardcoded background colors — not theme-aware |
| M6 | **`var` mixed with `let`/`const`** | Various files | Inconsistent variable declarations |
| M7 | **Sensitive data in console.log** | [`middleware/auth.js:25,42,54,72`](middleware/auth.js:25) | Debug logging leaks user emails and IP addresses to stdout |
| M8 | **CORS overly permissive** | [`server.js:95-126`](server.js:95-126) | Allows any valid domain via regex pattern — consider restricting to known origins in production |

### 🟢 Low

| # | Issue | Location | Details |
|---|-------|----------|---------|
| L1 | **Hardcoded text strings** | All HTML/JS files | All UI text is hardcoded in English — would need extraction for i18n |
| L2 | **No Docker health check for HTTPS** | [`Dockerfile:50-51`](Dockerfile:50-51) | Health check only checks HTTP port 3001 |
| L3 | **Unused imports** | Various | Some files have unused `require()` statements |
| L4 | **Missing favicon for 404/500 pages** | [`404.html`](404.html), [`500.html`](500.html) | Error pages don't include favicon |

---

## DEPRECATED Code That Should Be Removed

This code exists in the codebase but serves no purpose and should be cleaned up:

| File | Lines | What | Why Remove |
|------|-------|------|------------|
| [`auth.js:310-425`](auth.js:310-425) | 115 | `getUserDatabase()`, `saveUserDatabase()`, `createUser()`, `legacyUpdateUser()`, `legacyDeleteUser()`, `getUsersByRole()`, `updateUserInDatabase()` | All legacy localStorage-based user management — the real data is on the server |
| [`auth.js:163-307`](auth.js:163-307) | 144 | `initiateAuthentikLogin()`, `handleAuthentikCallback()`, `exchangeAuthentikCode()`, `fetchAuthentikUserInfo()`, `refreshAuthentikToken()` | Deprecated frontend-only SSO with hardcoded placeholder values. Server-side SSO in [`routes/sso.js`](routes/sso.js) handles this properly |
| [`auth.js:148-156`](auth.js:148-156) | 8 | `getUserPreferences()` | Uses `localStorage` for preferences — should use server-side settings via [`theme.js`](theme.js) instead |
| [`auth.js:406-425`](auth.js:406-425) | 19 | `trackUserActivity()` | Writes to `localStorage` — should use the server's `activity_log` table via datalayer |
| [`routes/auth.js:8`](routes/auth.js:8), [`routes/users.js:15`](routes/users.js:15) | 2 | `process.env.JWT_SECRET \|\| 'your-jwt-secret-change-in-production'` | Dead code — server.js validates JWT_SECRET at startup and exits if missing |
| [`index.html.bak`](index.html.bak) | ~800 | Backup copy of index.html | Leftover file that shouldn't be in production |
| [`database.db.bak`](database.db.bak) | ~? | Database backup | Should be excluded via `.gitignore` or moved to a backup directory |

---

## Updated Phased Recommendations

### Phase A — Immediate Fixes (Data Integrity & Security Bugs)

These are bugs that should be fixed as soon as possible:

1. **Standardize 2FA key names across the entire codebase**
   - Files: [`routes/2fa.js`](routes/2fa.js), [`routes/auth.js`](routes/auth.js), [`middleware/auth.js`](middleware/auth.js), [`base.js`](base.js)
   - Standardize to `two_factor_enabled`, `two_factor_secret`, `two_factor_backup_codes`
   - Include a DB migration script for existing data
   - Remove duplicate `/disable` and `/generate-secret` routes

2. **Fix SMTP security issues**
   - Encode SMTP password at rest (base64 obfuscation minimum)
   - Remove `rejectUnauthorized: false` and `ciphers: 'SSLv3'`
   - Add SMTP validation on save (auto-test connection)

3. **Fix session cookie secure flag**
   - Read `SESSION_SECURE` env var in [`server.js:140`](server.js:140)

4. **Fix SSO hardcoded redirect**
   - Remove `up-down.xyz` fallback in [`routes/sso.js`](routes/sso.js)

5. **Remove deprecated frontend code**
   - Legacy localStorage user management ([`auth.js:310-425`](auth.js:310-425))
   - Legacy frontend SSO ([`auth.js:163-307`](auth.js:163-307))

### Phase B — Security Hardening

1. **Implement CSRF protection** — Add CSRF tokens to API endpoints
2. **Harden CSP** — Move inline CSS/JS to external files, tighten CSP directives
3. **Add request payload size limiting** — Configure `express.json({ limit: '1mb' })`
4. **Remove JWT fallbacks** from route files (dead code cleanup)
5. **Harden error responses** — Never leak `err.message` to clients
6. **Add rate limit status headers** to all limiters
7. **Remove sensitive console.log** statements

### Phase C — Missing Features

1. **Build user-management.html** — The page referenced in [`base.js:29-33`](base.js:29-33) doesn't exist
2. **Connect logs.html to server API** — [`routes/audit.js`](routes/audit.js) is ready; just update the frontend
3. **Implement password reset flow** — Email-based reset with time-limited tokens
4. **Add user list pagination** — To [`routes/users.js`](routes/users.js) GET /
5. **Add "last admin" guard** — To [`routes/users.js`](routes/users.js) DELETE /:id
6. **Migrate remaining routes to datalayer** — [`routes/users.js`](routes/users.js) and [`routes/sso.js`](routes/sso.js) still use raw `global.db`

### Phase D — Code Quality & Testing

1. **Add test infrastructure** — Jest or Mocha + Chai + supertest for API integration tests
2. **Extract inline CSS** from [`base.js`](base.js) into a proper CSS file
3. **Refactor callback hell** in [`routes/auth.js`](routes/auth.js) and [`routes/2fa.js`](routes/2fa.js) to async/await
4. **Add CI/CD pipeline** — GitHub Actions for lint, test, build
5. **Add input validation** — Use Zod, Joi, or express-validator
6. **Consolidate theme enrollment API calls** into a single batch request

### Phase E — Enhancements (Optional)

1. **API versioning** — `/api/v1/*` prefix
2. **WebSocket support** — Real-time service status updates
3. **Automated backup scheduling** — DB backup UI
4. **Email templates** — Reusable HTML email templates
5. **User self-registration** — With admin approval
6. **i18n support** — Extract strings for localization
7. **Theme-aware service icons** — Respect dark mode/theme preferences
8. **Move QR library from CDN to self-hosted** in onboarding.html

---

## Architecture Observations

### Data Flow

```
Browser (HTML + vanilla JS)
  │
  ├── fetch() ──► Express Router ──► routes/*.js ──► lib/datalayer.js ──► SQLite3
  │                                      │
  │                                      └── middleware/auth.js (JWT, RBAC)
  │
  └── theme.js ──► localStorage + fetch(/api/settings/theme/preferences)
```

### Current Dependency Graph

```
server.js
  ├── routes/auth.js ──────────► middleware/auth.js
  ├── routes/users.js ─────────► middleware/auth.js, lib/datalayer.js
  ├── routes/2fa.js ───────────► middleware/auth.js, lib/datalayer.js
  ├── routes/settings.js ──────► middleware/auth.js, lib/datalayer.js
  ├── routes/services.js ──────► middleware/auth.js
  ├── routes/sso.js ───────────► lib/datalayer.js
  ├── routes/notifications.js ── (standalone, no middleware)
  └── routes/audit.js ─────────► middleware/auth.js, lib/datalayer.js
```

### Frontend Architecture

```
Page (login.html, dashboard.html, etc.)
  │
  └── base.js (initializePage)
        ├── loads api.js ──► ApiClient class
        ├── loads auth.js ──► Auth, User roles, Permissions
        ├── loads nav.js ───► Navigation, Page access control
        └── loads theme.js ──► ThemeManager (already loaded in <head>)
```

**Key observation:** The frontend uses a "script-loading pattern" where each HTML page dynamically loads shared scripts via `document.createElement('script')` in [`base.js:91-99`](base.js:91-99). This works but creates fragile timing dependencies. A bundler (Webpack, Vite) would be more robust.

---

## Summary Metrics

| Category | Count |
|----------|-------|
| Route files | 8 (auth, users, 2fa, settings, services, sso, notifications, audit) |
| Middleware files | 1 (auth.js) |
| Library files | 1 (datalayer.js) |
| HTML pages | 10 (index, login, dashboard, setup, onboarding, settings, logs, manage-services, 404, 500) |
| Frontend JS files | 4 (api.js, auth.js, nav.js, theme.js) + base.js (template) |
| Service templates | 40+ |
| Themes | 6 |
| Notification event types | 9 |
| Total backend JS | ~5,000+ lines |
| Total frontend JS | ~3,500+ lines |
| CSS in JS (base.js) | ~1,041 lines |
| logs.html | ~1,446 lines (all client-side, localStorage-based) |
| Existing plans | 4 (landio-assessment.md, phase1, phase2, phase3) |

---

**Files Referenced:**

- [`server.js`](server.js) — Main Express server entry point
- [`routes/auth.js`](routes/auth.js) — Authentication routes
- [`routes/2fa.js`](routes/2fa.js) — Two-factor authentication
- [`routes/users.js`](routes/users.js) — User management
- [`routes/settings.js`](routes/settings.js) — Settings management
- [`routes/services.js`](routes/services.js) — Service management
- [`routes/notifications.js`](routes/notifications.js) — Notification system
- [`routes/sso.js`](routes/sso.js) — SSO/OIDC integration
- [`routes/audit.js`](routes/audit.js) — Audit log API
- [`middleware/auth.js`](middleware/auth.js) — Shared auth middleware
- [`lib/datalayer.js`](lib/datalayer.js) — Centralized data access layer
- [`base.js`](base.js) — Frontend base template system
- [`auth.js`](auth.js) — Frontend authentication/authorization
- [`api.js`](api.js) — Frontend API client
- [`nav.js`](nav.js) — Navigation system
- [`theme.js`](theme.js) — Theme manager
- [`login.html`](login.html) — Login page
- [`dashboard.html`](dashboard.html) — Dashboard page
- [`index.html`](index.html) — Home page
- [`logs.html`](logs.html) — Logs page (needs rewrite)
- [`setup.html`](setup.html) — Initial setup page
- [`onboarding.html`](onboarding.html) — 2FA onboarding page
- [`Dockerfile`](Dockerfile) — Docker build configuration
- [`.env.example`](.env.example) — Environment configuration
- [`package.json`](package.json) — Project manifest
