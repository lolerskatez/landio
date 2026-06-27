# Landio Project Assessment

## Overview
Landio is a server management dashboard with a Node.js/Express backend, SQLite3 database, and vanilla HTML/CSS/JS frontend. It supports authentication, RBAC, 2FA, SSO/OIDC, service monitoring, notifications (SMTP + Discord), theme management, and session handling.

---

## 🚩 What's Missing (Feature Gaps)

### 1. No Password Reset / Forgot Password Flow
- [`.env.example`](.env.example) declares `ENABLE_PASSWORD_RESET` but there is **no implementation** of a forgot-password or password reset flow anywhere in the codebase.
- Users who forget their password must contact an admin, who must manually update it via the user management page.

### 2. No Audit Trail / Log Browser UI
- The database has an `activity_log` table and the server logs authentication events (login, logout, failed attempts) via [`auditLog()`](routes/auth.js:298-311), but there is **no dedicated admin UI** to browse, filter, or search logs.
- The only access is raw SQL or the generic logs page whose contents are unclear.

### 3. No Automated Backups
- No UI or server-side mechanism for scheduling or triggering database backups.
- The `.env.example` has no backup-related configuration.

### 4. No WebSocket / Real-Time Updates
- Service health monitoring ([`routes/services.js`](routes/services.js:522-560)) uses HTTP probing on demand. There's no WebSocket support for pushing real-time service status updates to connected clients.
- Dashboard relies on manual refresh or polling.

### 5. No User Self-Registration
- Users must be created by an admin. There's no self-registration flow or invite system.
- This is likely intentional, but worth noting as a design constraint.

### 6. No API Versioning
- All API routes are at `/api/*` with no version prefix (e.g., `/api/v1/*`). This makes future API evolution harder.

### 7. No Test Infrastructure
- [`package.json`](package.json) lists no test framework, no test scripts, and no test files exist anywhere in the project.
- Zero automated testing coverage for any route or utility.

### 8. No CI/CD Pipeline
- The `.github/` directory exists but contains no actual workflow files for CI/CD automation.

### 9. No Rate Limiting on Authentication Endpoints
- Global rate limiter exists at [`server.js:46-50`](server.js:46-50), but there's **no specific rate limiting** on `/api/auth/login` to prevent brute-force attacks beyond the `checkAccountLockout` mechanism.

### 10. No Email Templates for Notifications
- SMTP notification emails use inline HTML strings in [`routes/notifications.js:217-346`](routes/notifications.js:217-346) with no template system (no Handlebars, EJS, etc.).

---

## ⚠️ What Needs Improvement (Quality & Security Issues)

### Critical

| Issue | Location | Details |
|-------|----------|---------|
| **Hardcoded JWT Secrets** | [`routes/auth.js:11-106`](routes/auth.js:11-106), [`routes/users.js:6-24`](routes/users.js:6-24) | Both files contain `process.env.JWT_SECRET || 'your-jwt-secret-change-in-production'` as a hardcoded fallback. If env var isn't set, all tokens are signed with a known string. |
| **Hardcoded SSO Logout Redirect** | [`routes/sso.js:508`](routes/sso.js:508) | SSO logout hardcodes `https://up-down.xyz/` as the redirect URL. |
| **Session `secure: false` by Default** | [`server.js:123-127`](server.js:123-127) | Session cookie `secure: false` means cookies are sent over HTTP, not just HTTPS. |
| **Duplicate `authenticateToken` Middleware** | [`routes/auth.js:11-106`](routes/auth.js:11-106), [`routes/users.js:6-24`](routes/users.js:6-24), [`routes/settings.js:12-17`](routes/settings.js:12-17), [`routes/services.js:16-21`](routes/services.js:16-21) | The same JWT verification logic is copy-pasted across 4+ files instead of being a shared module. |

### High

| Issue | Location | Details |
|-------|----------|---------|
| **Duplicate 2FA Endpoints** | [`routes/2fa.js:10`](routes/2fa.js:10) and [`routes/2fa.js:125`](routes/2fa.js:125) | Both `/setup` and `/generate-secret` do the same thing (generate TOTP secret + QR code). |
| **`/disable` Route Defined Twice** | [`routes/2fa.js:98`](routes/2fa.js:98) and [`routes/2fa.js:254`](routes/2fa.js:254) | The second definition silently overrides the first. |
| **Inconsistent 2FA Key Names** | [`routes/2fa.js`](routes/2fa.js) throughout | Uses `twofa_enabled`, `twoFactorEnabled`, `twofa_secret`, `twoFactorSecret` interchangeably across different endpoints. This can cause logic bugs where settings are saved under one key but read under another. |
| **Callback Hell / Deep Nesting** | [`routes/auth.js`](routes/auth.js), [`routes/2fa.js`](routes/2fa.js) | Heavy use of nested callbacks (5-7 levels deep in places). Makes code hard to follow and maintain. |
| **JWT Refresh Token Ignores Session Timeout** | [`routes/auth.js:794-805`](routes/auth.js:794-805) | The `/refresh` endpoint always issues a 24h token, ignoring the user's configured `session-timeout` setting. |
| **SSO Username Conflict Resolution** | [`routes/sso.js:314-396`](routes/sso.js:314-396) | Uses recursion with numbered suffixes (baseUser1, baseUser2, etc.) which works but is fragile and hard to test. |

### Medium

| Issue | Location | Details |
|-------|----------|---------|
| **1041 Lines of CSS Injected via JS** | [`base.js:151-1044`](base.js:151-1044) | All navigation bar CSS is inline JavaScript string concatenation. This should be a separate CSS file. |
| **No ESM Modules** | All `.js` files | Using CommonJS `require()` throughout. Modern Node.js LTS fully supports ESM. |
| **Duplicate User 2FA Reset Endpoint** | [`routes/users.js:579-585`](routes/users.js:579-585) and [`routes/2fa.js:601-614`](routes/2fa.js:601-614) | Both routes define an admin 2FA reset endpoint with similar but not identical logic. |
| **Sensitive Data in Error Responses** | [`routes/2fa.js:492-495`](routes/2fa.js:492-495), [`routes/sso.js:125-130`](routes/sso.js:125-130) | Server errors may leak internal state or DB details to clients. |
| **Hardcoded Default Values** | [`routes/auth.js:274-295`](routes/auth.js:274-295) | Session timeout defaults to 3600 seconds if not configured, with no env var override. |
| **Self-Delete Prevention Gap** | [`routes/users.js:500-542`](routes/users.js:500-542) | Admin cannot delete themselves, but there's no "last admin" check — a scenario where the last admin account could be left without sufficient checks. |
| **CSP `unsafe-inline` Directives** | [`server.js:27-43`](server.js:27-43) | Content Security Policy uses `'unsafe-inline'` and `http:` sources for scripts/styles, which weakens XSS protection. |
| **SQL Injection Surface** | Various route files | Raw SQL queries using string interpolation (e.g., template literals in SQL) rather than parameterized queries in several places. |

### Low

| Issue | Location | Details |
|-------|----------|---------|
| **Mixed `var` and `let`/`const`** | Various | Some older-style `var` declarations alongside modern `let`/`const`. |
| **Missing Input Validation** | [`routes/settings.js`](routes/settings.js) | Settings values aren't strictly validated by type/schema before being stored. |
| **No Pagination for User List** | [`routes/users.js:89-121`](routes/users.js:89-121) | Returns all users at once — problematic for large deployments. |
| **No Service Health Timeout Handler** | [`routes/services.js:529-546`](routes/services.js:529-546) | HTTP health check uses `http.get()` without a proper timeout handler in some code paths. |
| **Theme Preferences Saved Per-Request** | [`base.js:1675-1703`](base.js:1675-1703) | Theme enrollment sends 3 separate API requests instead of batching. |

---

## 🏆 What's Done Well

### Architecture
- **Clean separation** of route modules by domain (auth, 2FA, users, settings, services, notifications, SSO).
- **Well-documented** architecture ([`ARCHITECTURE.md`](ARCHITECTURE.md), [`README.md`](README.md)).
- **Good use of environment variables** with sensible defaults and a comprehensive [`.env.example`](.env.example).

### Security
- **Comprehensive security stack**: Helmet, CORS validation, rate limiting, bcrypt, JWT, session management.
- **IP whitelist support** for access control per user.
- **2FA** with TOTP, backup codes, enforcement policies, and grace periods.
- **Account lockout** after failed login attempts with configurable duration.
- **Password policy validation** (min 8 chars, uppercase, lowercase, numbers, special chars).

### Features
- **42+ service templates** for auto-discovery ([`routes/services.js:77-398`](routes/services.js:77-398)).
- **SSO/OIDC** with PKCE support and group-to-role mapping.
- **6 themes** (pastel, cyber, mocha, ice, nature, sunset) with dark mode, high contrast, reduce motion.
- **Event-based notification system** supporting SMTP and Discord webhooks.
- **Docker support** with multi-stage Alpine builds and health checks.
- **Graceful shutdown** with notification dispatch.
- **Role-based access control** (admin, poweruser, user) with per-service access levels.
- **Frontend API client** with auto token refresh queue pattern ([`api.js:28-63`](api.js:28-63)).

### Documentation
- Comprehensive [`README.md`](README.md) with feature lists, quick start, API endpoints, and troubleshooting.
- Detailed [`ARCHITECTURE.md`](ARCHITECTURE.md) with system diagrams, flows, and data model.
- Deployment guide ([`DEPLOYMENT.md`](DEPLOYMENT.md)) and Docker docs ([`DOCKER.md`](DOCKER.md)).
- [`CHANGELOG.md`](CHANGELOG.md) for version tracking.

---

## 💡 Recommendations

### Phase 1: Security Hardening (High Priority)

1. **Extract shared middleware** into a single module (e.g., `middleware/auth.js`) to eliminate code duplication across route files.
2. **Remove hardcoded JWT secrets** — require `JWT_SECRET` env var at startup; crash with a clear error if not set.
3. **Fix session cookie `secure` flag** — make it configurable via env var, defaulting to `true` when HTTPS is enabled.
4. **Fix inconsistent 2FA key names** — standardize on a single naming convention (e.g., `two_factor_*` snake_case for DB consistency).
5. **Remove duplicate 2FA routes** — consolidate `/setup` and `/generate-secret` into one endpoint.
6. **Add login rate limiting** — specific rate limiter on `/api/auth/login` (e.g., 5 attempts per minute per IP).
7. **Fix SSO logout redirect** — make the post-logout redirect URL configurable, not hardcoded.
8. **Add input validation** for settings values using a schema validator (Joi, Zod, or express-validator).

### Phase 2: Code Quality (Medium Priority)

1. **Implement a test suite** — start with integration tests for all API routes using Mocha + Chai + supertest.
2. **Refactor nested callbacks** to async/await or Promises throughout [`routes/auth.js`](routes/auth.js) and [`routes/2fa.js`](routes/2fa.js).
3. **Extract inline CSS** from [`base.js:151-1044`](base.js:151-1044) into a proper CSS file.
4. **Migrate to ESM** — convert CommonJS `require()` to ES module `import` syntax.
5. **Add pagination** to the user list endpoint.
6. **Add API versioning** prefix (`/api/v1/...`) for future-proofing.
7. **Implement proper timeout handling** for service health checks.

### Phase 3: Feature Additions (Low Priority)

1. **Implement password reset flow** — email-based reset with time-limited tokens.
2. **Add audit log browser UI** — admin page with filtering by user, action, date range.
3. **Add WebSocket support** — push real-time service health updates to dashboard.
4. **Add automated backup UI** — schedule DB backups, download backups.
5. **Create email notification templates** — reusable HTML email templates.
6. **Implement user self-registration** with admin approval (optional, configurable).
7. **Add CI/CD pipeline** — GitHub Actions for lint, test, build, deploy.

### Phase 4: Polish (Nice-to-Have)

1. **Add pagination** to the logs display.
2. **Consolidate theme enrollment API calls** into a single batch request.
3. **Add "last admin" guard** to prevent deleting the only admin account.
4. **Add proper error boundaries** with user-friendly error messages instead of raw server errors.
5. **Consider migrating from SQLite to PostgreSQL** for production scalability.

---

## Key Metrics

| Category | Count |
|----------|-------|
| Production Dependencies | 15 |
| Route Files | 7 |
| Service Templates | 42+ |
| Theme Variations | 6 |
| Security Middleware | 6+ (Helmet, CORS, Rate Limit, Session, JWT, bcrypt) |
| Notification Events | 9 types |
| Lines of Frontend JS | ~3,000+ |
| Lines of Backend JS | ~4,500+ |

---

## Files Referenced During Assessment

- [`package.json`](package.json) — Dependencies and project metadata
- [`README.md`](README.md) — Project documentation
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Architecture documentation
- [`server.js`](server.js) — Main Express server (514 lines)
- [`.env.example`](.env.example) — Environment configuration template
- [`routes/auth.js`](routes/auth.js) — Authentication system (903 lines)
- [`routes/2fa.js`](routes/2fa.js) — Two-factor authentication (693 lines)
- [`routes/users.js`](routes/users.js) — User management (602 lines)
- [`routes/settings.js`](routes/settings.js) — Settings management (690 lines)
- [`routes/services.js`](routes/services.js) — Service management (826 lines)
- [`routes/notifications.js`](routes/notifications.js) — Notification system (377 lines)
- [`routes/sso.js`](routes/sso.js) — SSO/OIDC integration (537 lines)
- [`api.js`](api.js) — Frontend API client (264 lines)
- [`nav.js`](nav.js) — Navigation and access control (465 lines)
- [`base.js`](base.js) — Base template system (1,943 lines)
- [`theme.js`](theme.js) — Theme manager (313 lines)
- [`Dockerfile`](Dockerfile) — Docker build configuration
- [`docker-compose.yml`](docker-compose.yml) — Docker Compose configuration
