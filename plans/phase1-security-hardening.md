# Phase 1: Security Hardening Plan

## Corrections to Original Assessment

After thorough codebase investigation, **4 of the 6 items identified in the assessment are already resolved** in the current codebase:

| Item | Original Claim | Actual State | Verdict |
|------|---------------|--------------|---------|
| S1 | Hardcoded JWT secret fallbacks in multiple route files | `middleware/auth.js` uses `process.env.JWT_SECRET` with `process.exit(1)` on missing; `server.js` validates it at startup; all route files import from middleware. **Zero hardcoded fallbacks found.** | ✅ Already fixed |
| S4 | Session `secure: false` hardcoded default | `server.js:138` already uses `secure: process.env.SESSION_SECURE === 'true'` — fully configurable via env var | ✅ Already fixed |
| S5 | SQL injection surface in legacy routes | All 4 template-literal SQL queries found use proper `?` parameterized placeholders with no variable interpolation | ✅ Already safe |
| S6 | No brute-force rate limit on login endpoint | `routes/auth.js:11-17` defines `loginLimiter` (max: 20/15min) and it IS applied at `router.post('/login', loginLimiter, ...)` on line 322 | ✅ Already fixed |

**2 remaining items require action:**

---

## Item 1: SSO Error Detail Exposure (S2)

**Severity:** Critical | **File:** [`routes/sso.js`](routes/sso.js)

### Problem
Four error handlers return `error.message` directly to the client, potentially leaking internal state, stack traces, or sensitive configuration details:

| Line | Route | Current Code | Risk |
|------|-------|-------------|------|
| [76](routes/sso.js:76) | `POST /config` (OIDC init) | `error: err.message` | Leaks OIDC discovery errors |
| [95](routes/sso.js:95) | `POST /config` (update) | `error: error.message` | Leaks config save errors |
| [172-173](routes/sso.js:172-173) | `GET /login` | `error: error.message` | Leaks OIDC client init errors |
| [431](routes/sso.js:431) | `POST /logout` | `error: error.message` | Leaks token revocation errors |

### Fix Steps

**File:** [`routes/sso.js`](routes/sso.js)

1. **Line 73-77** — Replace `error: err.message` with generic `'Failed to initialize OIDC client'`:
   ```javascript
   // BEFORE:
   error: err.message
   // AFTER: (remove error field entirely, log to console)
   // (console.error already logs 'Failed to initialize OIDC client:', err on line 72)
   ```

2. **Line 92-96** — Replace `error: error.message` with generic message:
   ```javascript
   // BEFORE:
   error: error.message
   // AFTER: (remove error line)
   ```

3. **Line 169-174** — Replace `error: error.message` with generic:
   ```javascript
   // BEFORE:
   error: error.message
   // AFTER: (remove error line, console.error already present on line 169)
   ```

4. **Line 427-432** — Replace `error: error.message` with generic:
   ```javascript
   // BEFORE:
   error: error.message
   // AFTER: (remove error line)
   ```

**Risk:** Low — simple removal of `error.message` from response objects. Console logging remains intact for debugging.

---

## Item 2: CSP `unsafe-inline` Directives (S3)

**Severity:** High | **File:** [`server.js`](server.js) (CSP config), all HTML pages, [`base.js`](base.js)

### Problem
The Content Security Policy uses `'unsafe-inline'` for both `styleSrc` and `scriptSrc`, significantly weakening XSS protection. However, the codebase currently **depends** on inline styles/scripts because:

- Each HTML page has inline `<style>` blocks (~100-200 lines each)
- Each HTML page has inline `<script>` blocks with page-specific logic
- [`base.js:151-1055`](base.js:151-1055) injects ~904 lines of CSS into the DOM via JavaScript
- Theme CSS variables are applied inline via `theme.js`

### Architecture Decision

**Two approaches evaluated:**

| Approach | Effort | Security | Complexity |
|----------|--------|----------|------------|
| **A:** Externalize all inline CSS to `.css` files, use nonce-based CSP for inline scripts | High (~8-10 files) | Strong (strict CSP) | High — requires restructuring all HTML pages |
| **B:** Use strict CSP with `'strict-dynamic'` + nonces for scripts, keep small inline styles hashed | Medium | Strong (modern CSP) | Medium — requires nonce generation per request |

**Recommended:** Approach A — but split into sub-tasks to avoid a monolithic change.

### Fix Steps

#### Step 2a: Externalize nav bar CSS from base.js
**File:** [`base.js`](base.js)

1. Extract lines [151-1055](base.js:151-1055) into `styles/nav.css`
2. Replace the `injectNavBarCSS()` function to:
   - Create a `<link rel="stylesheet" href="/styles/nav.css">` element
   - OR check if the stylesheet is already loaded
3. Add the link tag to each HTML page's `<head>` section

#### Step 2b: Externalize common theme CSS from each HTML page
**Files:** All HTML pages (8 pages with inline base styles)

1. Extract the common base `:root` variable definitions into `styles/base.css`
2. Extract the theme CSS variable blocks from `settings.html` into `styles/themes.css`
3. Reference these via `<link>` tags

#### Step 2c: Externalize page-specific inline styles
**Files:** Each HTML page

1. Move per-page inline `<style>` blocks into `styles/pages/` directory
   - `styles/pages/dashboard.css`
   - `styles/pages/login.css`
   - `styles/pages/settings.css`
   - etc.
2. Replace with `<link>` tags in each HTML page

#### Step 2d: Tighten CSP directives
**File:** [`server.js`](server.js)

Once all inline styles/scripts are externalized:

```javascript
// BEFORE (lines 42-51):
contentSecurityPolicy: {
    directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
        fontSrc: ["'self'", "https:", "http:", "data:"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
        connectSrc: ["'self'", "https:", "http:"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
    },
}

// AFTER:
contentSecurityPolicy: {
    directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "https:", "http:"],
        fontSrc: ["'self'", "https:", "http:", "data:"],
        scriptSrc: ["'self'", "https:", "http:"],
        connectSrc: ["'self'", "https:", "http:"],
        imgSrc: ["'self'", "data:", "https:", "http:"],
    },
}
```

**Note:** If any inline scripts remain (e.g., the setup-status check in `index.html`), use nonce-based approach:
```javascript
scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`, "https:", "http:"],
```
Then add `nonce="..."` to inline `<script>` tags.

#### Step 2e: Remove JS-injected CSS dependency
**File:** [`base.js`](base.js)

1. Delete the `injectNavBarCSS()` function (or reduce to a no-op for backward compatibility)
2. Ensure all pages load `styles/nav.css`

---

## Risk Assessment

| Change | Risk Level | Mitigation |
|--------|-----------|------------|
| SSO error message removal | **Low** | Console logging remains; affects only error responses |
| CSS extraction from base.js | **Medium** | Must ensure all pages get the link tag; test nav bar rendering on every page |
| CSS extraction from HTML pages | **Medium** | Must maintain identical styling; visual regression testing needed |
| CSP tightening | **High** | If any inline style/script is missed, the entire page breaks. Must test thoroughly. |

## Rollback Plan

For each change:
1. **SSO fix**: Revert the 4 changed lines — single-file change, trivial
2. **CSP fix**: Keep the original CSP config commented out in `server.js`; revert `'unsafe-inline'` if pages break
3. **CSS extraction**: Keep original inline `<style>` blocks commented out in each HTML page temporarily

## Testing Strategy

1. After SSO fix: Test all SSO error scenarios (invalid config, unreachable IdP, logout failures)
2. After CSS extraction: Load each page, verify nav bar, verify theme application, verify layout
3. After CSP tightening: Load each page in browser dev tools, check for CSP violations in console
4. After full fix: Run the application for 24h to catch edge cases

---

## Summary Table

| # | File(s) | Change Description | Lines Changed | Risk |
|---|---------|-------------------|---------------|------|
| 2.1 | `routes/sso.js` | Remove `error.message` from 4 error responses | 4 lines | Low |
| 2.2 | `base.js` + new `styles/nav.css` | Extract 904 lines of CSS to external file | 1 file created, 1 modified | Medium |
| 2.3 | All 8 HTML pages | Extract inline styles to `styles/pages/*.css` | 8 files created, 8 modified | Medium |
| 2.4 | `server.js` | Remove `'unsafe-inline'` from CSP directives | 2 lines | High |
| 2.5 | `base.js` | Remove `injectNavBarCSS()` function | ~900 lines removed | Low |
