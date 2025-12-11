const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { Issuer, generators } = require('openid-client');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
let codeVerifier = null;

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
            return res.status(400).json({ 
                success: false, 
                message: 'SSO is not enabled' 
            });
        }

        if (!oidcClient) {
            return res.status(500).json({ 
                success: false, 
                message: 'SSO client not initialized' 
            });
        }

        // Generate code verifier and challenge for PKCE
        codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);

        const authUrl = oidcClient.authorizationUrl({
            scope: ssoConfig.scopes,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });

        res.json({ 
            success: true, 
            authUrl 
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
 * SSO callback handler
 */
router.get('/callback', async (req, res) => {
    try {
        if (!oidcClient) {
            return res.redirect('/login.html?error=sso_not_configured');
        }

        const params = oidcClient.callbackParams(req);
        
        const tokenSet = await oidcClient.callback(
            ssoConfig.redirectUri,
            params,
            { code_verifier: codeVerifier }
        );

        const userInfo = await oidcClient.userinfo(tokenSet.access_token);

        // Map OIDC user to your user structure
        const user = {
            id: userInfo.sub,
            email: userInfo.email,
            name: userInfo.name || userInfo.preferred_username || userInfo.email,
            role: 'user', // Default role - you might want to map this from claims
            avatar: userInfo.picture || '👤',
            ssoUser: true
        };

        // Generate JWT token
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                name: user.name, 
                role: user.role 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Redirect to dashboard with token
        res.redirect(`/dashboard.html?sso_token=${token}`);
    } catch (error) {
        console.error('SSO callback error:', error);
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

module.exports = router;
