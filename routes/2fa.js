const express = require('express');
const router = express.Router();
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const authenticateToken = require('./auth').authenticateToken;
const authenticateFor2FAEnrollment = require('./auth').authenticateFor2FAEnrollment;

// Alias endpoints for frontend compatibility
// POST /api/2fa/setup -> /generate-secret
router.post('/setup', authenticateFor2FAEnrollment, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Generate secret
        const secret = speakeasy.generateSecret({
            name: `Landio (${userId})`,
            length: 32
        });

        // Generate QR code
        const qrCode = await QRCode.toDataURL(secret.otpauth_url);
        
        // Generate backup codes
        const backupCodes = [];
        for (let i = 0; i < 10; i++) {
            backupCodes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
        }

        // Store temporary secret in session (not saved to DB yet)
        res.json({
            success: true,
            secret: secret.base32,
            qrCode: qrCode,
            backupCodes: backupCodes
        });
    } catch (error) {
        console.error('Error generating 2FA secret:', error);
        res.status(500).json({ error: 'Failed to generate 2FA secret' });
    }
});

// POST /api/2fa/verify-setup -> /verify
router.post('/verify-setup', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { code, secret } = req.body;

        // Verify the TOTP code
        const isValid = speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: code,
            window: 2
        });

        if (!isValid) {
            return res.status(400).json({ error: 'Invalid verification code', verified: false });
        }

        // Generate backup codes
        const backupCodes = [];
        for (let i = 0; i < 10; i++) {
            backupCodes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
        }

        // Save 2FA settings to database (using settings table for consistency)
        global.db.run(
            `INSERT OR REPLACE INTO settings (user_id, key, value, category)
             VALUES (?, 'twoFactorSecret', ?, 'security'),
                    (?, 'twoFactorBackupCodes', ?, 'security'),
                    (?, 'twofa_enabled', 'true', 'security')`,
            [
                userId, secret,
                userId, JSON.stringify(backupCodes),
                userId
            ],
            (err) => {
                if (err) {
                    console.error('Error saving 2FA settings:', err);
                    return res.status(500).json({ error: 'Failed to save 2FA settings' });
                }

                res.json({
                    success: true,
                    verified: true,
                    message: '2FA enabled successfully',
                    backupCodes: backupCodes
                });
            }
        );
    } catch (error) {
        console.error('Error verifying 2FA:', error);
        res.status(500).json({ error: 'Failed to verify 2FA' });
    }
});

// POST /api/2fa/disable
router.post('/disable', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;

        global.db.run(
            `DELETE FROM settings 
             WHERE user_id = ? AND key IN ('twoFactorEnabled', 'twoFactorSecret', 'twoFactorBackupCodes')`,
            [userId],
            (err) => {
                if (err) {
                    console.error('Error disabling 2FA:', err);
                    return res.status(500).json({ error: 'Failed to disable 2FA' });
                }

                res.json({
                    success: true,
                    message: '2FA has been disabled'
                });
            }
        );
    } catch (error) {
        console.error('Error disabling 2FA:', error);
        res.status(500).json({ error: 'Failed to disable 2FA' });
    }
});

// Generate TOTP secret
router.post('/generate-secret', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Generate secret
        const secret = speakeasy.generateSecret({
            name: `Landio (${userId})`,
            length: 32
        });

        // Generate QR code
        const qrCode = await QRCode.toDataURL(secret.otpauth_url);
        
        // Generate backup codes
        const backupCodes = [];
        for (let i = 0; i < 10; i++) {
            backupCodes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
        }

        // Store temporary secret in session (not saved to DB yet)
        res.json({
            secret: secret.base32,
            qrCode: qrCode,
            backupCodes: backupCodes
        });
    } catch (error) {
        console.error('Error generating 2FA secret:', error);
        res.status(500).json({ error: 'Failed to generate 2FA secret' });
    }
});

// Verify TOTP token and enable 2FA
router.post('/verify', authenticateFor2FAEnrollment, async (req, res) => {
    try {
        const userId = req.user.id;
        const { code, secret } = req.body;

        // Verify the TOTP code
        const isValid = speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: code,
            window: 2
        });

        if (!isValid) {
            return res.status(400).json({ error: 'Invalid verification code', verified: false });
        }

        // Generate backup codes
        const backupCodes = [];
        for (let i = 0; i < 10; i++) {
            backupCodes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
        }

        // Save 2FA settings to database (use settings table for consistency)
        global.db.run(
            `INSERT OR REPLACE INTO settings (user_id, key, value, category)
             VALUES (?, 'twoFactorSecret', ?, 'security'),
                    (?, 'twoFactorBackupCodes', ?, 'security'),
                    (?, 'twofa_enabled', 'true', 'security')`,
            [
                userId, secret,
                userId, JSON.stringify(backupCodes),
                userId
            ],
            (err) => {
                if (err) {
                    console.error('Error saving 2FA settings:', err);
                    return res.status(500).json({ error: 'Failed to save 2FA settings' });
                }

                // Get user data to return
                global.db.get(
                    'SELECT id, name, email, role FROM users WHERE id = ?',
                    [userId],
                    (userErr, user) => {
                        if (userErr || !user) {
                            console.error('Error fetching user data:', userErr);
                            // Return success even if we can't fetch user data
                            return res.json({
                                verified: true,
                                message: '2FA enabled successfully',
                                backupCodes: backupCodes
                            });
                        }

                        res.json({
                            verified: true,
                            message: '2FA enabled successfully',
                            backupCodes: backupCodes,
                            user: user
                        });
                    }
                );
            }
        );
    } catch (error) {
        console.error('Error verifying 2FA:', error);
        res.status(500).json({ error: 'Failed to verify 2FA' });
    }
});

// Check 2FA status
router.get('/status', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;

        global.db.get(
            `SELECT value FROM settings 
             WHERE user_id = ? AND key = 'twofa_enabled'`,
            [userId],
            (err, row) => {
                if (err) {
                    console.error('Error checking 2FA status:', err);
                    return res.status(500).json({ error: 'Failed to check 2FA status' });
                }

                const enabled = row && row.value === 'true';
                res.json({ enabled: enabled });
            }
        );
    } catch (error) {
        console.error('Error checking 2FA status:', error);
        res.status(500).json({ error: 'Failed to check 2FA status' });
    }
});

// Disable 2FA
router.post('/disable', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;

        global.db.run(
            `DELETE FROM settings 
             WHERE user_id = ? AND key = 'twofa_enabled'`,
            [userId],
            (err) => {
                if (err) {
                    console.error('Error disabling 2FA:', err);
                    return res.status(500).json({ error: 'Failed to disable 2FA' });
                }

                res.json({ message: '2FA disabled successfully' });
            }
        );
    } catch (error) {
        console.error('Error disabling 2FA:', error);
        res.status(500).json({ error: 'Failed to disable 2FA' });
    }
});

// Verify TOTP during login
router.post('/verify-login', (req, res) => {
    try {
        const { userId, code } = req.body;

        global.db.get(
            `SELECT value FROM settings 
             WHERE user_id = ? AND key IN ('twofa_secret', 'twoFactorSecret')
             ORDER BY CASE WHEN key = 'twoFactorSecret' THEN 1 ELSE 2 END
             LIMIT 1`,
            [userId],
            (err, row) => {
                if (err || !row) {
                    return res.status(400).json({ error: 'Invalid TOTP code' });
                }

                const secret = row.value;

                // Try verifying with the main code
                let isValid = speakeasy.totp.verify({
                    secret: secret,
                    encoding: 'base32',
                    token: code,
                    window: 2
                });

                // If not valid, check backup codes
                if (!isValid) {
                    global.db.get(
                        `SELECT value FROM settings 
                         WHERE user_id = ? AND key IN ('backup_codes', 'twoFactorBackupCodes')
                         ORDER BY CASE WHEN key = 'twoFactorBackupCodes' THEN 1 ELSE 2 END
                         LIMIT 1`,
                        [userId],
                        (err, backupRow) => {
                            if (err || !backupRow) {
                                return res.status(400).json({ error: 'Invalid TOTP code' });
                            }

                            try {
                                // Handle both JSON array and comma-separated string formats
                                let backupCodes;
                                try {
                                    backupCodes = JSON.parse(backupRow.value);
                                } catch {
                                    backupCodes = backupRow.value.split(',');
                                }

                                const codeIndex = backupCodes.indexOf(code.toUpperCase());

                                if (codeIndex === -1) {
                                    return res.status(400).json({ error: 'Invalid TOTP code' });
                                }

                                // Remove used backup code
                                backupCodes.splice(codeIndex, 1);
                                
                                // Save in the same format it was stored
                                const newValue = backupRow.value.startsWith('[') 
                                    ? JSON.stringify(backupCodes) 
                                    : backupCodes.join(',');
                                
                                global.db.run(
                                    `UPDATE settings 
                                     SET value = ?
                                     WHERE user_id = ? AND key IN ('backup_codes', 'twoFactorBackupCodes')`,
                                    [newValue, userId]
                                );

                                res.json({ verified: true, message: 'Backup code used' });
                            } catch (parseErr) {
                                res.status(400).json({ error: 'Invalid TOTP code' });
                            }
                        }
                    );
                } else {
                    res.json({ verified: true });
                }
            }
        );
    } catch (error) {
        console.error('Error verifying TOTP:', error);
        res.status(500).json({ error: 'Failed to verify TOTP' });
    }
});

// Get 2FA enforcement status
router.get('/enforcement-status', authenticateToken, async (req, res) => {
    try {
        // Only admins can view enforcement settings
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Get enforcement settings from settings table (system-level settings)
        // Get the most recent value for each key
        const queries = [
            `SELECT value FROM settings 
             WHERE key = 'enforce-2fa-all-users' AND user_id IS NULL 
             ORDER BY updated_at DESC LIMIT 1`,
            `SELECT value FROM settings 
             WHERE key = 'enforce-2fa-admins-only' AND user_id IS NULL 
             ORDER BY updated_at DESC LIMIT 1`,
            `SELECT value FROM settings 
             WHERE key = 'twofa-grace-period' AND user_id IS NULL 
             ORDER BY updated_at DESC LIMIT 1`
        ];

        // Execute all queries
        let enforce2faAllUsers = false;
        let enforce2faAdminsOnly = false;
        let twoFAGracePeriod = 7;

        let completedQueries = 0;
        const totalQueries = queries.length;
        let hasError = false;

        queries.forEach((query, index) => {
            global.db.get(query, (err, row) => {
                // Only process if we haven't already sent an error response
                if (hasError) return;

                if (err) {
                    console.error(`2FA enforcement query ${index} error:`, err);
                    hasError = true;
                    return res.status(500).json({ error: 'Database error', details: err.message });
                }

                // Set the value based on which query this is
                if (index === 0 && row) { // enforce-2fa-all-users
                    enforce2faAllUsers = row.value === 'true';
                } else if (index === 1 && row) { // enforce-2fa-admins-only
                    enforce2faAdminsOnly = row.value === 'true';
                } else if (index === 2 && row) { // twofa-grace-period
                    twoFAGracePeriod = parseInt(row.value) || 7;
                }

                completedQueries++;
                if (completedQueries === totalQueries) {
                    // All queries completed, continue with the rest of the logic
                    processEnforcementStatus();
                }
            });
        });

        function processEnforcementStatus() {
            // Determine mode
            let mode = 'none';
            if (enforce2faAllUsers) {
                mode = 'all-users';
            } else if (enforce2faAdminsOnly) {
                mode = 'admins-only';
            }

            // Count users with 2FA enabled
            global.db.get(
                `SELECT COUNT(*) as count FROM settings 
                 WHERE key = 'twoFactorEnabled' AND value = 'true' AND user_id IS NOT NULL`,
                (err, row) => {
                    // Check if error occurred and prevent multiple responses
                    if (hasError) return;

                    if (err) {
                        console.error('2FA count query error:', err);
                        hasError = true;
                        return res.status(500).json({ error: 'Database error', details: err.message });
                    }

                    const usersWithTFA = row ? row.count : 0;

                    // Calculate grace period expiry
                    let gracePeriodExpires = null;
                    if (twoFAGracePeriod > 0) {
                        const expiryDate = new Date();
                        expiryDate.setDate(expiryDate.getDate() + twoFAGracePeriod);
                        gracePeriodExpires = expiryDate.toISOString();
                    }

                    res.json({
                        success: true,
                        mode: mode,
                        enforce2faAllUsers: enforce2faAllUsers,
                        enforce2faAdminsOnly: enforce2faAdminsOnly,
                        twoFAGracePeriod: twoFAGracePeriod,
                        usersWithTFA: usersWithTFA,
                        gracePeriodExpires: gracePeriodExpires
                    });
                }
            );
        }
    } catch (error) {
        console.error('Error getting 2FA enforcement status:', error);
        res.status(500).json({ error: 'Failed to get 2FA enforcement status' });
    }
});

// Admin: Get all users' 2FA status
router.get('/admin/users-2fa-status', authenticateToken, async (req, res) => {
    try {
        // Only admins can access
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        global.db.all(
            `SELECT u.id, u.name, u.email, u.role, 
                    CASE WHEN s.value = 'true' THEN 1 ELSE 0 END as twoFactorEnabled
             FROM users u
             LEFT JOIN settings s ON u.id = s.user_id AND s.key = 'twofa_enabled'
             ORDER BY u.name`,
            (err, users) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }

                res.json({
                    success: true,
                    users: users || []
                });
            }
        );
    } catch (error) {
        console.error('Error fetching users 2FA status:', error);
        res.status(500).json({ error: 'Failed to fetch users 2FA status' });
    }
});

// Admin: Reset user's 2FA (require new setup)
router.post('/admin/reset/:userId', authenticateToken, async (req, res) => {
    try {
        // Only admins can access
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const targetUserId = req.params.userId;

        // Delete user's 2FA settings
        global.db.run(
            `DELETE FROM settings 
             WHERE user_id = ? AND key IN ('twofa_secret', 'backup_codes', 'twofa_enabled')`,
            [targetUserId],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }

                // Log activity
                global.db.run(
                    `INSERT INTO activity_log (user_id, action, description) 
                     VALUES (?, ?, ?)`,
                    [req.user.id, '2FA_RESET_ADMIN', `Admin reset 2FA for user ${targetUserId}`]
                );

                res.json({
                    success: true,
                    message: 'User 2FA has been reset'
                });
            }
        );
    } catch (error) {
        console.error('Error resetting user 2FA:', error);
        res.status(500).json({ error: 'Failed to reset user 2FA' });
    }
});

// Admin: Force user to enroll 2FA
router.post('/admin/force-enroll/:userId', authenticateToken, async (req, res) => {
    try {
        // Only admins can access
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const targetUserId = req.params.userId;

        // Set flag indicating user must enroll 2FA
        global.db.run(
            `INSERT INTO settings (user_id, key, value, category) 
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
            [targetUserId, '2faEnrollmentRequired', 'true', 'security'],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }

                // Log activity
                global.db.run(
                    `INSERT INTO activity_log (user_id, action, description) 
                     VALUES (?, ?, ?)`,
                    [req.user.id, '2FA_FORCE_ENROLL_ADMIN', `Admin forced 2FA enrollment for user ${targetUserId}`]
                );

                res.json({
                    success: true,
                    message: 'User will be required to enroll 2FA on next login'
                });
            }
        );
    } catch (error) {
        console.error('Error forcing 2FA enrollment:', error);
        res.status(500).json({ error: 'Failed to force 2FA enrollment' });
    }
});

// Admin: Unenroll user from 2FA
router.post('/admin/unenroll/:userId', authenticateToken, async (req, res) => {
    try {
        // Only admins can access
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const targetUserId = req.params.userId;

        // Delete user's 2FA settings
        global.db.run(
            `DELETE FROM settings 
             WHERE user_id = ? AND key IN ('twofa_secret', 'backup_codes', 'twofa_enabled', '2faEnrollmentRequired')`,
            [targetUserId],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }

                // Log activity
                global.db.run(
                    `INSERT INTO activity_log (user_id, action, description) 
                     VALUES (?, ?, ?)`,
                    [req.user.id, '2FA_UNENROLL_ADMIN', `Admin unenrolled user ${targetUserId} from 2FA`]
                );

                res.json({
                    success: true,
                    message: 'User has been unenrolled from 2FA'
                });
            }
        );
    } catch (error) {
        console.error('Error unenrolling user from 2FA:', error);
        res.status(500).json({ error: 'Failed to unenroll user from 2FA' });
    }
});

// Admin: Get specific user's 2FA details
router.get('/admin/user-2fa/:userId', authenticateToken, async (req, res) => {
    try {
        // Only admins can access
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const targetUserId = req.params.userId;

        global.db.get(
            `SELECT u.id, u.name, u.email, u.role 
             FROM users u WHERE u.id = ?`,
            [targetUserId],
            (err, user) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }

                if (!user) {
                    return res.status(404).json({ error: 'User not found' });
                }

                // Get 2FA settings
                global.db.all(
                    `SELECT key, value FROM settings 
                     WHERE user_id = ? AND key IN ('twofa_enabled', 'twofa_secret', 'backup_codes', '2faEnrollmentRequired')`,
                    [targetUserId],
                    (err, settings) => {
                        if (err) {
                            return res.status(500).json({ error: 'Database error' });
                        }

                        let twoFactorEnabled = false;
                        let backupCodesCount = 0;
                        let enrollmentRequired = false;

                        if (settings) {
                            settings.forEach(setting => {
                                if (setting.key === 'twofa_enabled') {
                                    twoFactorEnabled = setting.value === 'true';
                                } else if (setting.key === 'backup_codes') {
                                    try {
                                        const codes = setting.value.split(',');
                                        backupCodesCount = Array.isArray(codes) ? codes.length : 0;
                                    } catch (e) {
                                        backupCodesCount = 0;
                                    }
                                } else if (setting.key === '2faEnrollmentRequired') {
                                    enrollmentRequired = setting.value === 'true';
                                }
                            });
                        }

                        res.json({
                            success: true,
                            user: user,
                            twoFactorEnabled: twoFactorEnabled,
                            backupCodesRemaining: backupCodesCount,
                            enrollmentRequired: enrollmentRequired
                        });
                    }
                );
            }
        );
    } catch (error) {
        console.error('Error getting user 2FA details:', error);
        res.status(500).json({ error: 'Failed to get user 2FA details' });
    }
});

module.exports = router;
