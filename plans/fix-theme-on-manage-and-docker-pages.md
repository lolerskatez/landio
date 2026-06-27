# Plan: Fix Active Theme Not Applied on Manage Services & Docker Pages

## Problem Summary

The active theme (Pastel, Cyber Sakura, Sunset, etc.) is not visually applied on two pages:

1. **Docker page** (`docker.html`) — Theme script missing entirely; zero theme CSS
2. **Manage Services page** (`manage-services.html`) — Theme script loads but CSS has minimal theme overrides

## Root Cause Analysis

### Issue 1: `docker.html` — Missing Theme Script

[`docker.html`](docker.html:3-12) does not include `<script src="theme.js"></script>` in its `<head>`. Every other functional page in the app loads this script.

Without it, the [`ThemeManager`](theme.js:7) class never initializes, so no theme CSS classes (`theme-cyber`, `theme-sunset`, `dark-mode`, etc.) are ever applied to `<body>`. Even if the CSS had theme overrides, they would never activate.

### Issue 2: `styles/pages/docker.css` — Zero Theme-Specific CSS

[`styles/pages/docker.css`](styles/pages/docker.css) contains **no** `body.theme-cyber`, `body.theme-sunset`, or `body.dark-mode` selectors at all. It relies on CSS custom properties with hardcoded fallbacks (e.g., `var(--bg-secondary, #f5f5f5)`), but those variables are only defined within theme blocks in other page CSS files. So fallback values are always used.

Elements missing theme overrides:
- Header, page header, h1
- Docker toolbar, search box, filter selects
- Docker table (container, header cells, data cells, rows)
- Status badges
- All buttons (`.btn`, `.btn-primary`, `.btn-success`, etc.)
- Detail sections in modals
- Form inputs and selects in modals
- Log viewer
- Empty state / unavailable state

### Issue 3: `styles/pages/manage-services.css` — Minimal Theme Support

[`styles/pages/manage-services.css`](styles/pages/manage-services.css) has only 5 `body.theme-*` rules (autodiscover button + results). Missing overrides for:
- Header, h1, h2, subtitle
- Services section background
- Services grid and service cards
- Modal overlay, modal content, modal header
- Form labels, inputs, selects
- All buttons (`.btn`, `.btn-primary`)
- Service icon preview
- Keyframe animations (slideIn, slideOut)

---

## Detailed Implementation Steps

### Fix 1: Add `theme.js` to `docker.html` `<head>`

**File:** [`docker.html`](docker.html:3-12)

Add the theme script tag between the CSS links and `</head>`, matching the pattern used by other pages:

```html
<!-- Load theme manager early to apply preferences before page renders -->
<script src="theme.js"></script>
```

Note: `docker.html` uses **relative paths** (e.g., `href="styles/base.css"`), so use `src="theme.js"` (not `/theme.js`).

### Fix 2: Add Theme-Specific CSS to `styles/pages/docker.css`

**File:** [`styles/pages/docker.css`](styles/pages/docker.css) — Append after existing `@media` block (before file end)

Add comprehensive theme blocks for **3 themes** (matching the pattern in reference files like [`styles/pages/index.css:456-605`](styles/pages/index.css:456) and [`styles/pages/settings.css:29-410`](styles/pages/settings.css:29)):

#### 2a. CSS Variable Blocks (3 themes + dark mode)

Following the established pattern from other pages, define CSS variables and body background for each theme:

```
body.theme-pastel { ... }  — variables match base pastel defaults
body.theme-cyber { ... }   — dark theme with neon accents
body.theme-sunset { ... }  — warm gradient theme
.dark-mode { ... }         — dark color overrides
```

#### 2b. Component Overrides Per Theme

For each of the 3 themes + dark mode, add `body.theme-*` / `.dark-mode` overrides for:

| CSS Selector | Elements to Override |
|---|---|
| `header` | background, box-shadow, color |
| `.page-header h1` | color |
| `.docker-table-container` | background, border-color |
| `.docker-table th` | background, color, border-bottom |
| `.docker-table td` | border-bottom |
| `.docker-table tr:hover` | background |
| `.search-box` | background |
| `.search-box input` | color, placeholder |
| `.filter-group select` | background, border-color, color |
| `.status-badge` variant classes | background, color |
| `.btn` | background, border-color, color |
| `.btn-primary`, `.btn-success`, etc. | background, border-color, color |
| `.detail-section` | background, border-color |
| `.detail-section h3` | color, border-bottom |
| `.detail-item label` | color |
| `.form-input` | background, border-color, color |
| `.form-input:focus` | border-color, box-shadow |
| `.log-viewer` | background, color (cyber/dark override default dark bg) |
| `.docker-unavailable .empty-state` | color |
| `.empty-state code` | background |

### Fix 3: Add Theme-Specific CSS to `styles/pages/manage-services.css`

**File:** [`styles/pages/manage-services.css`](styles/pages/manage-services.css) — Replace existing minimal theme blocks (lines 45-66) with comprehensive ones

#### 3a. CSS Variable Blocks (3 themes + dark mode)

Same pattern as Fix 2a — define theme variables and body background.

#### 3b. Component Overrides Per Theme

For each of the 3 themes + dark mode, add overrides for:

| CSS Selector | Elements to Override |
|---|---|
| `header` | background, box-shadow, color |
| `h1`, `h2` | color |
| `.subtitle` | color |
| `.services-section` | background |
| `.services-grid` | (via service cards) |
| `header button` / `.btn` | background, color, border |
| `.btn-primary` | background |
| `.modal-overlay` | background |
| `.modal-content` | background |
| `.modal-header h2` | color |
| `.modal-close` | color |
| `label` / `.form-group label` | color |
| `input`, `select` | background, border-color, color, box-shadow |
| `.btn-autodiscover` | background gradient (keep existing, expand to pastel/sunset/dark) |
| `#autodiscover-results` | background, border-left-color (keep existing, expand) |

### Theme Color Reference

Use consistent colors matching the existing theme system:

| Theme | Primary | Accent Colors | BG Colors |
|---|---|---|---|
| **Pastel** | `#ff6b93` | `#a6d8ff`, `#ffccd5` | White/light gradients |
| **Cyber Sakura** | `#FF5FA2` | `#00E0FF`, `#C77DFF`, `#FF9BD4` | `#0E0A1F`, `#1C1433`, `#241A40` |
| **Sunset** | `#FF6A3D` | `#A14BFF` | `#FFF7F3`, white |
| **Dark Mode** | `#ff6b9d` | `#4ecdc4` | `#1a1a1a`, `#2d2d2d`, `#3d3d3d` |

## Files to Modify

1. [`docker.html`](docker.html:3-12) — Add `<script src="theme.js"></script>` to `<head>`
2. [`styles/pages/docker.css`](styles/pages/docker.css) — Add ~200 lines of theme-specific CSS
3. [`styles/pages/manage-services.css`](styles/pages/manage-services.css) — Replace minimal theme blocks with ~200 lines of comprehensive theme CSS

## Verification

After implementation, switch to each theme (Pastel, Cyber Sakura, Sunset) and verify on both pages:
1. Background gradient/color changes appropriately
2. Cards/sections have correct background
3. Text colors update correctly
4. Input/select/button styles match the theme
5. Modals reflect the theme correctly
6. Dark mode toggle works correctly on both pages
