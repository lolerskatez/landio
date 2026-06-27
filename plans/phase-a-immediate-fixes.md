# Phase A — Immediate Fixes: Implementation Plan

## Overview
Seven work items covering the critical bugs and deprecated code removal identified in the assessment.

---

## Work Item 1: Standardize 2FA Key Names + Remove Duplicate Routes

### Problem
The 2FA system uses **6 different key names** across [`routes/2fa.js`](routes/2fa.js):
- `twofa_enabled`, `twoFactorEnabled`, `twoFactorSecret`, `twofa_secret`, `twoFactorBackupCodes`, `backup_codes`

Two duplicate routes: `/generate-secret` (overlaps `/setup`), second `/disable` (overrides first).

### Standardization Target
| Old Key | New Standard Key |
|---------|-----------------|
| `twofa_enabled` | `two_factor_enabled` |
| `twoFactorEnabled` | `two_factor_enabled` |
| `twoFactorSecret` | `two_factor_secret` |
| `twofa_secret` | `two_factor_secret` |
| `twoFactorBackupCodes` | `two_factor_backup_codes` |
| `backup_codes` | `two_factor_backup_codes` |

### Files to Modify
1. [`routes/2fa.js`](routes/2fa.js) — All key references + remove duplicate routes
2. [`routes/auth.js`](routes/auth.js) — `is2FARequired` function (lines ~32-104)
3. [`base.js`](base.js) — Frontend 2FA modal functions (verify-setup, verify, enable flows)
4. [`lib/datalayer.js`](lib/datalayer.js) — `twoFactor` domain methods (isEnabled, getEnrollmentData, getUserStatus, getAllUserStatus)

### DB Migration
After deploying, run this SQL to migrate existing data:
```sql
UPDATE settings SET key = 'two_factor_enabled' WHERE key IN ('twofa_enabled', 'twoFactorEnabled');
UPDATE settings SET key = 'two_factor_secret' WHERE key IN ('twofa_secret', 'twoFactorSecret');
UPDATE settings SET key = 'two_factor_backup_codes' WHERE key IN ('twoFactorBackupCodes', 'backup_codes');
```

---

## Work Item 2: SMTP Password Encoding + TLS Fix

### Changes in [`routes/settings.js`](routes/settings.js)
1. Add `smtpPasswordEncode(plaintext)` — `Buffer.from(plaintext).toString('base64')` with `b64:` prefix
2. Add `smtpPasswordDecode(stored)` — strip `b64:` prefix, decode base64
3. On save of `smtp-password`: encode before storing
4. On read of SMTP settings: decode before using
5. Fix TLS in auto-validation function: remove `ciphers: 'SSLv3'`, default `rejectUnauthorized` to true
6. Fix TLS in SMTP test endpoint (same issue)

### Changes in [`routes/notifications.js`](routes/notifications.js)
1. Add `smtpPasswordDecode()` helper (or share from settings.js)
2. Fix TLS defaults: remove SSLv3, make `rejectUnauthorized` configurable via env var
3. Fix in both `sendSmtpNotification` and `buildEmailContent`

---

## Work Item 3: Fix Session Cookie `secure` Flag

### Change in [`server.js:140`](server.js:140)
```javascript
// Before:
secure: false,

// After:
secure: process.env.SESSION_SECURE === 'true',
```

### Update `.env.example` (already done — `SESSION_SECURE=false` exists)

---

## Work Item 4: Fix SSO Hardcoded Redirect

### Change in [`routes/sso.js`](routes/sso.js)
Find the `redirectUri` line with `up-down.xyz` and replace with:
```javascript
const redirectUri = process.env.SSO_LOGOUT_REDIRECT || process.env.BASE_URL || '/';
```

---

## Work Item 5: Remove Deprecated Frontend Code

### Changes in [`auth.js`](auth.js)
Remove these functions (estimate ~260 lines):
1. `getUserDatabase()` — line ~310
2. `saveUserDatabase()` — ~line 315
3. `getUserById()` — ~line 325
4. `getUserByEmail()` — ~line 330
5. `createUser()` — ~line 335
6. `legacyUpdateUser()` — ~line 362
7. `legacyDeleteUser()` — ~line 381
8. `getUsersByRole()` — ~line 387
9. `updateUserInDatabase()` — ~line 392
10. `trackUserActivity()` — ~line 406
11. `initiateAuthentikLogin()` — ~line 163
12. `handleAuthentikCallback()` — ~line 181
13. `exchangeAuthentikCode()` — ~line 197
14. `fetchAuthentikUserInfo()` — ~line 233
15. `refreshAuthentikToken()` — ~line 280
16. `getUserPreferences()` — ~line 148

**Must also remove from `window.Auth = { ... }` export at bottom.**

---

## Work Item 6: Remove Leftover Files

### Files to Delete
1. [`index.html.bak`](index.html.bak)
2. [`database.db.bak`](database.db.bak)

---

## Work Item 7: Create `user-management.html`

### Requirements
New HTML page at [`user-management.html`](user-management.html) referenced in [`base.js:29-33`](base.js:29-33).

Must include:
- Admin-only access (enforced via [`nav.js`](nav.js) PAGE_ACCESS)
- User list with pagination
- Create user form (name, email, username, password, role dropdown)
- Edit user modal/inline
- Delete user with confirmation
- 2FA status column per user
- User activity log per user
- Search/filter users

### API Endpoints to Use
- `GET /api/users` — List users (currently returns all; will add pagination later)
- `POST /api/users` — Create user
- `PUT /api/users/:id` — Update user
- `DELETE /api/users/:id` — Delete user
- `GET /api/users/:id/activity` — User activity log (from audit API)

---

## Execution Order

| Order | Item | Complexity | Notes |
|-------|------|-----------|-------|
| 1 | SMTP security | Low | Isolated changes to 2 files |
| 2 | Session cookie fix | Trivial | Single line change |
| 3 | SSO redirect fix | Trivial | Single line change |
| 4 | 2FA key standardization | High | Most complex — affects 4 files + DB migration |
| 5 | Remove deprecated code | Medium | auth.js cleanup + verify no breakage |
| 6 | Remove leftover files | Trivial | Delete 2 files |
| 7 | Create user-management.html | High | Large new page (~500-1000 lines) |

Items 1-3 can be done in parallel. Item 4 should be done alone due to its complexity. Items 5-6 are independent. Item 7 is a large standalone addition.
