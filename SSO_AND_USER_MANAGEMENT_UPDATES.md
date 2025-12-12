# SSO and User Management Updates

## Overview
This document details the comprehensive updates to support proper SSO/OIDC integration and enhanced user management with username and display name fields.

## Database Schema Changes

### New Columns Added to `users` Table
- **`username`** (TEXT, UNIQUE) - Unique username for login and display
- **`display_name`** (TEXT) - Friendly display name (can be different from full name)
- **`sso_provider`** (TEXT) - OIDC provider URL for tracking SSO users
- **`sso_id`** (TEXT, UNIQUE) - OIDC `sub` claim for user matching

### Migration
The `init-db.js` script now automatically adds these columns to existing databases when run. Columns that already exist are skipped gracefully.

## Backend Changes

### SSO Routes (`routes/sso.js`)

#### Complete Rewrite of `/api/sso/callback` Endpoint
The callback handler now:

1. **Extracts OIDC Claims**
   - Extracts `sub`, `email`, `name`, `picture`, and `groups` from ID token
   - Maps email to username
   - Handles different OIDC group claim formats (standard, Keycloak, etc.)

2. **Role Mapping**
   - Maps OIDC groups to user roles
   - Supports admin groups: `admin`, `administrators`, `realm-management:manage-users`
   - Supports power-user groups: `poweruser`, `power-users`, `managers`
   - Defaults to `user` role if no group matches
   - Updates role on each login from OIDC claims

3. **User Lookup/Creation**
   - Looks up user by `sso_id` (OIDC `sub` claim)
   - If user exists: Updates `last_login`, `login_count`, `display_name`, `role`, and `groups`
   - If user is new:
     - Generates username from email (e.g., `john@example.com` → `john`)
     - Handles username conflicts by appending counter (e.g., `john1`, `john2`)
     - Creates user with SSO provider and ID for future lookups
     - Sets `is_active = 1` by default

4. **JWT Generation**
   - Generates JWT with database user ID (not OIDC `sub`)
   - Includes: `id`, `username`, `email`, `name`, `displayName`, `role`, `ssoProvider`
   - 24-hour token expiration

5. **Activity Logging**
   - Logs SSO login events as `sso_login` action
   - Logs new user creation as `sso_signup` action

### Authentication Routes (`routes/auth.js`)

#### Setup Endpoint (`POST /api/auth/setup`)
- Now creates initial admin with `username` and `display_name` fields
- Username defaults to email prefix (e.g., `john@example.com` → `john`)
- Display name defaults to full name

#### Login Endpoint (`POST /api/auth/login`)
- JWT now includes: `username`, `displayName` (in addition to existing fields)
- Login response includes full user object with new fields

#### Two-Factor Complete (`POST /api/auth/2fa-complete`)
- JWT and user response include new fields

#### Refresh Endpoint (`POST /api/auth/refresh`)
- Refreshed JWT includes `username` and `displayName`

#### Me Endpoint (`GET /api/auth/me`)
- Returns `username`, `display_name`, and `sso_provider`
- Provides client with complete user information

### User Management Routes (`routes/users.js`)

#### List Users (`GET /api/users`)
- Now returns: `username`, `display_name`, and `sso_provider`

#### Get User (`GET /api/users/:id`)
- Now returns: `username`, `display_name`, and `sso_provider`

#### Create User (`POST /api/users`)
- Accepts `username`, `display_name` in request
- Auto-generates `username` from email if not provided
- Validates username uniqueness
- Display name defaults to full name if not provided
- Creates user with proper avatar initialization (2-char initials)

## Frontend Changes

### base.js
- `populateUserInfo()` now displays `displayName` (or falls back to `name`)
- User dropdown button shows display name instead of full name

### auth.js
- Frontend continues to store full user object in localStorage
- Automatically includes new fields when processing login/profile responses

### SSO Client Configuration (Optional)
For Authentik or other OIDC providers, ensure ID token includes:
```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "name": "Display Name",
  "picture": "avatar-url",
  "groups": ["admin", "users"]
}
```

## API Response Examples

### Successful SSO Login
```json
{
  "success": true,
  "redirectUri": "https://yourapp.com/dashboard.html?sso_token=..."
}
```

The token contains:
```json
{
  "id": 1,
  "username": "john",
  "email": "john@example.com",
  "name": "John Doe",
  "displayName": "John Doe",
  "role": "admin",
  "ssoProvider": "https://authentik.example.com",
  "iat": 1702276345,
  "exp": 1702362745
}
```

### User Object (from `/api/auth/me`)
```json
{
  "id": 1,
  "username": "john",
  "name": "John Doe",
  "displayName": "John Doe",
  "email": "john@example.com",
  "role": "admin",
  "avatar": "JD",
  "ssoProvider": "https://authentik.example.com",
  "groups": ["admin", "users"],
  "permissions": {...},
  "lastLogin": "2023-12-11T10:15:00Z",
  "loginCount": 42,
  "lastActivity": "2023-12-11T10:15:00Z"
}
```

## Configuration

### SSO Setup
1. Navigate to settings page
2. Enable SSO and configure:
   - Issuer URL: `https://authentik.example.com`
   - Client ID: Your OIDC application client ID
   - Client Secret: Your OIDC application client secret
   - Redirect URI: Auto-detected or set to `https://yourapp.com/api/sso/callback`

### OIDC Provider Configuration
Ensure your OIDC provider (Authentik, Keycloak, etc.) is configured with:
- **Redirect URI**: `https://yourapp.com/api/sso/callback`
- **Scopes**: `openid profile email groups`
- **Claims**: Ensure ID token includes `groups` claim

## Testing SSO Flow

### Manual Test
1. Configure SSO in settings
2. Visit login page and click "SSO Login"
3. Authenticate at your OIDC provider
4. Verify:
   - User created in database with `sso_id` and `sso_provider`
   - Correct role mapped from groups
   - JWT contains username and displayName
   - Activity log shows `sso_login` action

### Automated Test
```bash
# 1. Configure SSO via API
curl -X POST http://localhost:3000/api/sso/config \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "issuerUrl": "https://authentik.example.com",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret"
  }'

# 2. Check configuration
curl http://localhost:3000/api/sso/config

# 3. Initiate login
curl http://localhost:3000/api/sso/login
```

## Backward Compatibility

- **Username Field**: Optional for manually created users; auto-generated if not provided
- **Display Name**: Defaults to `name` field if not provided
- **SSO Fields**: Only populated for SSO users; null for local/password-based users
- **Existing Users**: Can still use password authentication; migrate to SSO as needed

## Migration from Old Schema

If you have an existing database without the new columns:

1. Run `npm run init-db` - automatically adds missing columns
2. Manually set `username` for existing users if desired:
   ```sql
   UPDATE users SET username = SUBSTR(email, 1, INSTR(email, '@') - 1) WHERE username IS NULL;
   ```
3. Set `display_name` equal to `name` for existing users:
   ```sql
   UPDATE users SET display_name = name WHERE display_name IS NULL;
   ```

## Security Considerations

- **PKCE Flow**: SSO callback uses PKCE (Proof Key for Code Exchange) for security
- **Token Validation**: JWT signature and user existence in database always validated
- **State Verification**: CSRF protection via state token in session (in-memory for now)
- **IP Whitelist**: IP whitelist security setting works with both password and SSO logins
- **Activity Logging**: All login/logout events logged for audit trail

## Troubleshooting

### Issue: "SSO client not initialized"
- **Cause**: SSO configuration not saved
- **Fix**: Go to settings and reconfigure SSO with valid issuer URL, client ID, and secret

### Issue: "Invalid OIDC configuration"
- **Cause**: Issuer discovery failed (bad URL or network issue)
- **Fix**: Verify issuer URL is correct and accessible from server

### Issue: User created but can't login
- **Cause**: Role mapping failed or user disabled
- **Fix**: Check activity log for SSO_SIGNUP, verify user in database has `is_active = 1`

### Issue: Wrong role assigned to SSO user
- **Cause**: Group claim not sent by OIDC provider or unexpected group name
- **Fix**: Check OIDC provider configuration; update group mapping in `sso.js` if using non-standard claim names

## Future Enhancements

- [ ] Admin UI for managing SSO group-to-role mappings
- [ ] Support for multiple SSO providers simultaneously
- [ ] Token refresh integration with OIDC provider
- [ ] Just-In-Time (JIT) provisioning of user attributes (photo, phone, etc.)
- [ ] User deprovisioning when removed from SSO provider
