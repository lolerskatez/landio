# Phase 2 — Configuration & Data Protection Plan

## Overview

Three work items to improve data handling, backup code management, and email notification security.

---

## Work Item 1: 2FA Backup Codes Rotation & Exhaustion Handling

**Problem:** Currently backup codes are removed one-by-one when used ([`routes/2fa.js:281-294`](routes/2fa.js:281-294)), but the system silently allows codes to run out — if all backup codes are exhausted, the user gets a generic "Invalid TOTP code" with no distinction from a wrong TOTP entry. There's also no way to regenerate backup codes without fully disabling and re-enabling 2FA.

### Changes

**1a — Distinguish "all backup codes exhausted" from "invalid code"**

In [`routes/2fa.js`](routes/2fa.js), after removing a used backup code and saving the updated list:

- Check if the remaining code count is 0.
- If 0, also delete the `two_factor_backup_codes` setting row entirely (clean slate).
- Return a distinct response `{ verified: true, message: 'Backup code used', codesRemaining: 0, exhausted: true }` instead of the generic `{ verified: true, message: 'Backup code used' }`.
- On the frontend in [`base.js`](base.js), when `exhausted: true` is received, display a warning banner prompting the user to regenerate backup codes.

**1b — Add `POST /api/2fa/regenerate-backup-codes` endpoint**

New endpoint in [`routes/2fa.js`](routes/2fa.js) (authenticated, 2FA must be enabled):

- Generates 10 new backup codes using `crypto.randomBytes(4).toString('hex').toUpperCase()` (same logic as existing setup).
- Saves them to `settings` table under key `two_factor_backup_codes`.
- Returns the new backup codes to the client with `{ backupCodes: [...], message: 'New backup codes generated' }`.
- **Important:** This invalidates all previously unused backup codes — the old ones are replaced entirely.

**1c — Frontend: Add "Regenerate Backup Codes" UI in 2FA modal**

In [`base.js:1375-1493`](base.js:1375-1493) (`openTwoFactorModal` function):

- After the 2FA status check, if 2FA is enabled, show a "Regenerate Backup Codes" button.
- On click, call `POST /api/2fa/regenerate-backup-codes`.
- Display the new codes in a `backup-codes-display` area within the modal.
- Include a "Copy" button and a "Download" button for the codes.

### Files to modify
| File | What changes |
|------|-------------|
| [`routes/2fa.js`](routes/2fa.js) | Modify backup code exhaustion handling (lines ~281-294); add `/regenerate-backup-codes` endpoint |
| [`base.js`](base.js) | Add "Regenerate Backup Codes" UI; handle `exhausted: true` response |
| [`api.js`](api.js) | Add `regenerateBackupCodes()` method to `ApiClient` class |

---

## Work Item 2: Create Centralized Database Access Layer (`lib/datalayer.js`)

**Problem:** [`global.db`](http://search:77) is referenced **77 times** across 7 route files. This is:
- **Tightly coupled** to the global scope — impossible to mock for testing
- **Callback-heavy** — nested callbacks 5-7 levels deep ([`routes/auth.js`](routes/auth.js), [`routes/2fa.js`](routes/2fa.js))
- **Inconsistent** — some files use `getDb()` wrappers, others use `global.db` directly
- **SQL injection surface** — some queries use string interpolation

### Solution: `lib/datalayer.js`

Create a module that wraps all database operations with Promises and provides descriptive method names.

```
lib/datalayer.js
```

**Exported API:**

```javascript
// Generic wrappers (return Promises)
datalayer.get(sql, params)     // db.get() → single row
datalayer.all(sql, params)     // db.all() → array of rows
datalayer.run(sql, params)     // db.run() → result

// User methods
datalayer.users.findById(id)
datalayer.users.findByEmail(email)
datalayer.users.findByUsername(username)
datalayer.users.findAll()
datalayer.users.create(data)
datalayer.users.update(id, data)
datalayer.users.delete(id)
datalayer.users.incrementFailedAttempts(id)
datalayer.users.resetFailedAttempts(id)
datalayer.users.updateLastLogin(id)
datalayer.users.count()

// Settings methods
datalayer.settings.get(key, userId?)
datalayer.settings.set(key, value, userId?, category?)
datalayer.settings.delete(key, userId?)
datalayer.settings.getByUser(userId)
datalayer.settings.getSystemSettings()

// Activity log methods
datalayer.activityLog.create(userId, action, details, ipAddress, userAgent)
datalayer.activityLog.getByUser(userId, limit?)
datalayer.activityLog.getAll(limit?)

// Auth session methods
datalayer.authSessions.countByUser(userId)
```

**Implementation approach — incremental migration:**

1. Create [`lib/datalayer.js`](lib/datalayer.js) with all methods above, using Promise-based wrappers.
2. In [`server.js`](server.js), import datalayer and attach `global.db` to it during initialization. The datalayer module does **not** create its own connection — it receives `global.db` via a setter or is initialized after the DB connection is opened.
3. **High-priority migrations** (deepest callback hell):
   - [`routes/auth.js`](routes/auth.js) — migrate `isSystemInitialized`, `is2FARequired`, `getSecuritySetting`, `auditLog`, `checkAccountLockout`, `recordFailedAttempt`, `resetFailedAttempts`, login flow, `/me`, `/refresh`.
   - [`routes/2fa.js`](routes/2fa.js) — migrate all DB operations.
4. **Lower-priority** (if time permits):
   - [`routes/users.js`](routes/users.js), [`routes/settings.js`](routes/settings.js), [`routes/services.js`](routes/services.js), [`routes/sso.js`](routes/sso.js), [`routes/notifications.js`](routes/notifications.js).

**Why not a full ORM?** SQLite is the target DB and the queries are mostly straightforward key-value lookups. A thin abstraction layer gives us testability without the overhead of Sequelize/Knex. If migrating to PostgreSQL later, only this file needs to change.

### Files to create/modify
| File | What changes |
|------|-------------|
| [`lib/datalayer.js`](lib/datalayer.js) | **NEW** — Centralized DB access layer with all methods |
| [`server.js`](server.js) | Import datalayer; call `datalayer.initialize(global.db)` after DB connection |
| [`routes/auth.js`](routes/auth.js) | Migrate all `global.db` calls to `datalayer.*` |
| [`routes/2fa.js`](routes/2fa.js) | Migrate all `global.db` calls to `datalayer.*` |

---

## Work Item 3: Email Notification Hardening

**Problem:** Three issues with SMTP configuration:
1. SMTP settings are saved **without validation** — a typo in `smtp-server` or `smtp-port` won't be caught until the first notification fails.
2. Weak TLS defaults in [`routes/notifications.js:62-66`](routes/notifications.js:62-66): `rejectUnauthorized: false`, `ciphers: 'SSLv3'` (SSLv3 is deprecated and insecure).
3. SMTP password is stored in **plaintext** in the `settings` table.

### Changes

**3a — Validate SMTP settings on save**

In [`routes/settings.js`](routes/settings.js), intercept saves of SMTP-related keys (`smtp-server`, `smtp-port`, `smtp-username`, `smtp-password`, `smtp-use-tls`):

- If all 4 required settings (`smtp-server`, `smtp-port`, `smtp-username`, `smtp-password`) are now present, **automatically test the connection** using the same `transporter.verify()` logic from the existing test endpoint.
- If the test fails, **reject the save** with a clear error: `"SMTP configuration is invalid: [reason]"`.
- If only partial settings are provided, allow the save (user may be mid-configuration), but attach a warning.

Implementation: Create a middleware/helper function `validateSmtpOnSave(key, value, allSettings)` that's called from the `PUT /api/settings/:key` and `POST /api/settings` handlers.

**3b — Fix weak TLS defaults**

In [`routes/notifications.js:62-66`](routes/notifications.js:62-66):

- Change `rejectUnauthorized: false` → `rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'` (default to `true` — reject self-signed certs).
- Remove `ciphers: 'SSLv3'` entirely (SSLv3 is insecure). Let Node.js use its default cipher set.
- The existing test endpoint in [`routes/settings.js:351-354`](routes/settings.js:351-354) should also be updated to match.

Also apply the same fix in the **SMTP test endpoint** ([`routes/settings.js:343-356`](routes/settings.js:343-356)) which has the same `rejectUnauthorized: false` and `ciphers: 'SSLv3'` settings.

**3c — Basic SMTP password obfuscation at rest**

- In [`routes/settings.js`](routes/settings.js), when saving `smtp-password`:
  - Use `Buffer.from(password).toString('base64')` to encode it (basic obfuscation — not true encryption, but prevents casual reading from the DB).
- In [`routes/settings.js`](routes/settings.js) and [`routes/notifications.js`](routes/notifications.js), when reading `smtp-password`:
  - Decode with `Buffer.from(value, 'base64').toString('utf-8')`.
  - Fall back to plaintext if it doesn't decode properly (backward compatibility).

### Files to modify
| File | What changes |
|------|-------------|
| [`routes/settings.js`](routes/settings.js) | Add SMTP validation on save; fix TLS defaults; add base64 encoding for smtp-password |
| [`routes/notifications.js`](routes/notifications.js) | Fix TLS defaults; add base64 decoding for smtp-password |
| [`.env.example`](.env.example) | Add `SMTP_REJECT_UNAUTHORIZED` env var documentation |

---

## Dependency Changes

None — all functionality uses existing dependencies (`nodemailer`, `crypto`, `speakeasy`).

## Data Migration

No schema changes required — all data remains in the existing `settings` and `users` tables.

## Testing Notes

- After migration to `datalayer.js`, run `npm start` and verify no startup errors.
- After SMTP changes, test saving SMTP settings and verify the test endpoint still works.
- After backup code changes, verify a user can generate backup codes, use one, regenerate them, and that exhaustion is handled.
