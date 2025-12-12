const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { Issuer, generators } = require('openid-client');

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';

// SSO Configuration (will be loaded from settings)
let ssoConfig = {
    enabled: false,
    issuerUrl: '',
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    scopes: 'openid profile email'
};

// OIDC Client cache
let oidcClient = null;

/**
 * Update SSO configuration
 */
router.post('/config', async (req, res) => {
    try {
        const { enabled, issuerUrl, clientId, clientSecret, redirectUri, scopes } = req.body;
        
        ssoConfig = {
            enabled: enabled || false,
            issuerUrl: issuerUrl || '',
            clientId: clientId || '',
            clientSecret: clientSecret || '',
            redirectUri: redirectUri || `${req.protocol}://${req.get('host')}/api/sso/callback`,
            scopes: scopes || 'openid profile email'
        };

        // Save to database for persistence - both as sso-config JSON and individual settings
        global.db.run(
            `INSERT OR REPLACE INTO settings (user_id, key, value, category) VALUES (NULL, ?, ?, ?)`,
            ['sso-config', JSON.stringify(ssoConfig), 'sso'],
            (err) => {
                if (err) {
                    console.error('Error saving SSO config to database:', err);
                }
            }
        );

        // Also save individual SSO settings fields for use by settings page
        const stmt = global.db.prepare(
            `INSERT OR REPLACE INTO settings (user_id, key, value, category) VALUES (NULL, ?, ?, 'sso')`
        );

        stmt.run('sso-enabled', String(enabled || false));
        stmt.run('sso-issuer-url', issuerUrl || '');
        stmt.run('sso-client-id', clientId || '');
        stmt.run('sso-client-secret', clientSecret || '');
        stmt.run('sso-redirect-uri', redirectUri || `${req.protocol}://${req.get('host')}/api/sso/callback`);
        stmt.run('sso-scopes', scopes || 'openid profile email');
        stmt.finalize();

        // Initialize OIDC client if enabled
        if (enabled && issuerUrl && clientId && clientSecret) {
            try {
                const issuer = await Issuer.discover(issuerUrl);
                oidcClient = new issuer.Client({
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uris: [ssoConfig.redirectUri],
                    response_types: ['code']
                });
            } catch (err) {
                console.error('Failed to initialize OIDC client:', err);
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid OIDC configuration',
                    error: err.message 
                });
            }
        }

        res.json({ 
            success: true, 
            message: 'SSO configuration updated',
            config: {
                enabled: ssoConfig.enabled,
                issuerUrl: ssoConfig.issuerUrl,
                redirectUri: ssoConfig.redirectUri
            }
        });
    } catch (error) {
        console.error('Error updating SSO config:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update SSO configuration',
            error: error.message 
        });
    }
});

/**
 * Get SSO configuration (public - no sensitive data)
 */
router.get('/config', (req, res) => {
    res.json({
        enabled: ssoConfig.enabled,
        issuerUrl: ssoConfig.issuerUrl,
        redirectUri: ssoConfig.redirectUri
    });
});

/**
 * Initiate SSO login flow
 */
router.get('/login', async (req, res) => {
    try {
        if (!ssoConfig.enabled) {
            console.log('SSO login attempted but SSO is not enabled');
            return res.status(400).json({ 
                success: false, 
                message: 'SSO is not enabled' 
            });
        }

        if (!oidcClient) {
            console.error('OIDC client not initialized. SSO Config:', {
                enabled: ssoConfig.enabled,
                issuerUrl: ssoConfig.issuerUrl,
                clientId: ssoConfig.clientId ? '***' : 'missing',
                redirectUri: ssoConfig.redirectUri
            });
            return res.status(500).json({ 
                success: false, 
                message: 'SSO client not initialized' 
            });
        }

        // Generate code verifier for PKCE
        const codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);
        
        // Generate state for CSRF protection
        const state = generators.state();

        const authParams = {
            scope: ssoConfig.scopes,
            state: state
        };

        // Only include PKCE if the issuer supports it
        // Comment out these lines if your OIDC provider doesn't support PKCE
        // authParams.code_challenge = codeChallenge;
        // authParams.code_challenge_method = 'S256';

        // Generate authorization URL
        const authUrl = oidcClient.authorizationUrl(authParams);

        // Store state and code verifier in session for validation on callback
        req.session.oidc = {
            state,
            codeVerifier
        };

        console.log('SSO login initiated, state stored in session, redirecting to:', authUrl.split('?')[0]);
        res.json({ 
            success: true, 
            authUrl: authUrl
        });
    } catch (error) {
        console.error('Error initiating SSO login:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to initiate SSO login',
            error: error.message 
        });
    }
});

/**
 * SSO callback handler - Create/upsert user in database
 */
router.get('/callback', async (req, res) => {
    try {
        console.log('SSO callback received, query params:', req.query);
        
        if (!oidcClient) {
            console.error('OIDC client not initialized for callback');
            return res.redirect('/login.html?error=sso_not_configured');
        }

        const params = oidcClient.callbackParams(req);
        console.log('Callback params extracted:', { code: params.code ? 'present' : 'missing', state: params.state });
        
        // Retrieve state and code verifier from session
        const sessionOidc = req.session.oidc || {};
        console.log('Session OIDC data:', { 
            hasState: !!sessionOidc.state, 
            hasCodeVerifier: !!sessionOidc.codeVerifier 
        });
        
        const callbackChecks = {
            state: sessionOidc.state
        };
        
        // Build options for callback - include code_verifier only if PKCE was used
        const callbackOptions = sessionOidc.codeVerifier ? { code_verifier: sessionOidc.codeVerifier } : {};
        
        console.log('Exchanging code for tokens...');
        const tokenSet = await oidcClient.callback(
            ssoConfig.redirectUri,
            params,
            callbackChecks,
            callbackOptions
        );

        console.log('Getting user info...');
        const userInfo = await oidcClient.userinfo(tokenSet.access_token);

        // Extract user data from OIDC claims
        const ssoId = userInfo.sub;
        const email = userInfo.email;
        const displayName = userInfo.name || userInfo.preferred_username || userInfo.email;
        const picture = userInfo.picture;
        
        // Extract groups/roles from OIDC claims (different providers use different claim names)
        const groups = userInfo.groups || 
                      (userInfo.resource_access && userInfo.resource_access.roles) ||
                      (userInfo.realm_access && userInfo.realm_access.roles) || 
                      [];
        
        // Map OIDC groups to role (configurable, defaults to 'user')
        let role = 'user'; // Default role
        const adminGroups = ['admin', 'administrators', 'realm-management:manage-users'];
        const powerUserGroups = ['poweruser', 'power-users', 'managers'];
        
        if (Array.isArray(groups)) {
            const groupLower = groups.map(g => g.toLowerCase());
            if (groupLower.some(g => adminGroups.some(ag => g.includes(ag)))) {
                role = 'admin';
            } else if (groupLower.some(g => powerUserGroups.some(pg => g.includes(pg)))) {
                role = 'poweruser';
            }
        }

        // Generate username from email (handle duplicates)
        const baseUsername = email.split('@')[0];
        
        // Upsert user in database
        global.db.get(
            'SELECT id, name, display_name, email, role FROM users WHERE sso_id = ?',
            [ssoId],
            (err, existingUser) => {
                if (err) {
                    console.error('Database lookup error:', err);
                    return res.redirect(`/login.html?error=db_error&message=${encodeURIComponent(err.message)}`);
                }

                if (existingUser) {
                    // User exists - update last_login and other fields
                    const updateQuery = `
                        UPDATE users 
                        SET last_login = CURRENT_TIMESTAMP, 
                            login_count = login_count + 1,
                            display_name = ?,
                            role = ?,
                            groups = ?,
                            is_active = 1
                        WHERE id = ?
                    `;
                    
                    global.db.run(
                        updateQuery,
                        [displayName, role, JSON.stringify(groups), existingUser.id],
                        (err) => {
                            if (err) {
                                console.error('Database update error:', err);
                                return res.redirect(`/login.html?error=db_error`);
                            }
                            
                            // Log activity
                            global.db.run(
                                'INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
                                [existingUser.id, 'sso_login', `SSO login via ${ssoConfig.issuerUrl}`]
                            );

                            // Generate JWT with database user ID
                            const token = jwt.sign(
                                { 
                                    id: existingUser.id, 
                                    username: baseUsername,
                                    email: existingUser.email, 
                                    name: existingUser.name,
                                    displayName: displayName,
                                    role: role,
                                    ssoProvider: ssoConfig.issuerUrl
                                },
                                JWT_SECRET,
                                { expiresIn: '24h' }
                            );

                            // Clean up OIDC session data
                            delete req.session.oidc;

                            // Redirect to login page to handle SSO token callback
                            console.log('SSO callback complete, redirecting to login with token for user:', baseUsername);
                            res.redirect(`/login.html?sso_token=${token}`);
                        }
                    );
                } else {
                    // New user - create in database
                    // Generate unique username
                    let username = baseUsername;
                    let counter = 1;
                    
                    const checkAndCreateUser = (usernameToTry) => {
                        global.db.get(
                            'SELECT id FROM users WHERE username = ?',
                            [usernameToTry],
                            (err, userExists) => {
                                if (err) {
                                    console.error('Username check error:', err);
                                    return res.redirect(`/login.html?error=db_error`);
                                }

                                if (userExists) {
                                    // Username taken, try next
                                    checkAndCreateUser(`${baseUsername}${++counter}`);
                                } else {
                                    // Username available, create user
                                    const createQuery = `
                                        INSERT INTO users (
                                            username, name, display_name, email, 
                                            role, avatar, sso_provider, sso_id, 
                                            groups, is_active, last_login, login_count
                                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
                                    `;
                                    
                                    const avatar = displayName.split(' ')
                                        .map(n => n[0])
                                        .join('')
                                        .toUpperCase()
                                        .slice(0, 2);
                                    
                                    global.db.run(
                                        createQuery,
                                        [
                                            usernameToTry,
                                            displayName,
                                            displayName,
                                            email,
                                            role,
                                            avatar,
                                            ssoConfig.issuerUrl,
                                            ssoId,
                                            JSON.stringify(groups),
                                            1
                                        ],
                                        function(err) {
                                            if (err) {
                                                console.error('User creation error:', err);
                                                return res.redirect(`/login.html?error=create_failed&message=${encodeURIComponent(err.message)}`);
                                            }

                                            const newUserId = this.lastID;

                                            // Log activity
                                            global.db.run(
                                                'INSERT INTO activity_log (user_id, action, details) VALUES (?, ?, ?)',
                                                [newUserId, 'sso_signup', `New SSO user via ${ssoConfig.issuerUrl}`]
                                            );

                                            // Generate JWT with new database user ID
                                            const token = jwt.sign(
                                                { 
                                                    id: newUserId, 
                                                    username: usernameToTry,
                                                    email: email, 
                                                    name: displayName,
                                                    displayName: displayName,
                                                    role: role,
                                                    ssoProvider: ssoConfig.issuerUrl
                                                },
                                                JWT_SECRET,
                                                { expiresIn: '24h' }
                                            );

                                            // Clean up OIDC session data
                                            delete req.session.oidc;

                                            // Redirect to login page to handle SSO token callback
                                            res.redirect(`/login.html?sso_token=${token}`);
                                        }
                                    );
                                }
                            }
                        );
                    };

                    checkAndCreateUser(username);
                }
            }
        );
    } catch (error) {
        console.error('SSO callback error:', error);
        // Clean up OIDC session data on error
        delete req.session.oidc;
        res.redirect(`/login.html?error=sso_failed&message=${encodeURIComponent(error.message)}`);
    }
});

/**
 * SSO logout
 */
router.post('/logout', async (req, res) => {
    try {
        if (!oidcClient) {
            return res.json({ success: true });
        }

        const { token } = req.body;
        
        // Optionally revoke token at IdP
        if (token && oidcClient.revoke) {
            try {
                await oidcClient.revoke(token);
            } catch (err) {
                console.error('Token revocation failed:', err);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('SSO logout error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Load SSO configuration from database on startup
 */
function loadSSOConfigFromDatabase() {
    return new Promise((resolve) => {
        global.db.get(
            `SELECT value FROM settings WHERE user_id IS NULL AND key = 'sso-config'`,
            (err, row) => {
                if (err) {
                    console.error('Error loading SSO config from database:', err);
                    resolve();
                    return;
                }

                if (row && row.value) {
                    try {
                        const savedConfig = JSON.parse(row.value);
                        ssoConfig = savedConfig;
                        console.log('SSO configuration loaded from database');

                        // Reinitialize OIDC client if enabled
                        if (ssoConfig.enabled && ssoConfig.issuerUrl && ssoConfig.clientId && ssoConfig.clientSecret) {
                            Issuer.discover(ssoConfig.issuerUrl)
                                .then((issuer) => {
                                    oidcClient = new issuer.Client({
                                        client_id: ssoConfig.clientId,
                                        client_secret: ssoConfig.clientSecret,
                                        redirect_uris: [ssoConfig.redirectUri],
                                        response_types: ['code']
                                    });
                                    console.log('OIDC client reinitialized from saved config');
                                })
                                .catch((err) => {
                                    console.error('Failed to reinitialize OIDC client:', err);
                                });
                        }
                    } catch (parseErr) {
                        console.error('Error parsing SSO config:', parseErr);
                    }
                }
                resolve();
            }
        );
    });
}

// Export function for server to call on startup
router.loadSSOConfig = loadSSOConfigFromDatabase;

module.exports = router;
