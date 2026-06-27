const express = require('express');
const router = express.Router();
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const { authenticateToken, authenticateFor2FAEnrollment } = require('../middleware/auth');
const db = require('../lib/datalayer');

// Rate limiter for 2FA verification during login
const twoFALimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many 2FA attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Generate TOTP secret and QR code for 2FA setup
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

        // Save 2FA settings to database using datalayer
        await db.settings.set('two_factor_secret', secret, userId, 'security');
        await db.settings.set('two_factor_backup_codes', JSON.stringify(backupCodes), userId, 'security');
        await db.settings.set('two_factor_enabled', 'true', userId, 'security');

        res.json({
            success: true,
            verified: true,
            message: '2FA enabled successfully',
            backupCodes: backupCodes
        });
    } catch (error) {
        console.error('Error verifying 2FA:', error);
        res.status(500).json({ error: 'Failed to verify 2FA' });
    }
});

// Disable 2FA
router.post('/disable', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        await db.settings.deleteByKeys(
            ['two_factor_enabled', 'two_factor_secret', 'two_factor_backup_codes'],
            userId
        );

        res.json({
            success: true,
            message: '2FA has been disabled'
        });
    } catch (error) {
        console.error('Error disabling 2FA:', error);
        res.status(500).json({ error: 'Failed to disable 2FA' });
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

        // Save 2FA settings to database using datalayer
        await db.settings.set('two_factor_secret', secret, userId, 'security');
        await db.settings.set('two_factor_backup_codes', JSON.stringify(backupCodes), userId, 'security');
        await db.settings.set('two_factor_enabled', 'true', userId, 'security');

        // Get user data to return
        const user = await db.users.findById(userId);

        res.json({
            verified: true,
            message: '2FA enabled successfully',
            backupCodes: backupCodes,
            ...(user ? { user } : {})
        });
    } catch (error) {
        console.error('Error verifying 2FA:', error);
        res.status(500).json({ error: 'Failed to verify 2FA' });
    }
});

// Check 2FA status
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const value = await db.settings.get('two_factor_enabled', userId);
        const enabled = value === 'true';

        res.json({ enabled: enabled });
    } catch (error) {
        console.error('Error checking 2FA status:', error);
        res.status(500).json({ error: 'Failed to check 2FA status' });
    }
});

// Verify TOTP during login
router.post('/verify-login', twoFALimiter, async (req, res) => {
    try {
        const { userId, code } = req.body;

        // Get the 2FA secret
        const secretRow = await db.get(
            `SELECT value FROM settings
             WHERE user_id = ? AND key = 'two_factor_secret'
             LIMIT 1`,
            [userId]
        );

        if (!secretRow) {
            return res.status(400).json({ error: 'Invalid TOTP code' });
        }

        const secret = secretRow.value;

        // Try verifying with the main code
        let isValid = speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: code,
            window: 2
        });

        // If valid with main TOTP code, return success immediately
        if (isValid) {
            return res.json({ verified: true });
        }

        // Check backup codes
        const backupRow = await db.get(
            `SELECT value FROM settings
             WHERE user_id = ? AND key = 'two_factor_backup_codes'
             LIMIT 1`,
            [userId]
        );

        if (!backupRow) {
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

            if (backupCodes.length === 0) {
                // All backup codes exhausted — delete the setting row
                await db.run(
                    `DELETE FROM settings
                     WHERE user_id = ? AND key = 'two_factor_backup_codes'`,
                    [userId]
                );
                return res.json({
                    verified: true,
                    message: 'Backup code used',
                    codesRemaining: 0,
                    exhausted: true
                });
            }

            // Save in the same format it was stored
            const newValue = backupRow.value.startsWith('[')
                ? JSON.stringify(backupCodes)
                : backupCodes.join(',');

            await db.run(
                `UPDATE settings
                 SET value = ?
                 WHERE user_id = ? AND key = 'two_factor_backup_codes'`,
                [newValue, userId]
            );

            res.json({
                verified: true,
                message: 'Backup code used',
                codesRemaining: backupCodes.length
            });
        } catch (parseErr) {
            res.status(400).json({ error: 'Invalid TOTP code' });
        }
    } catch (error) {
        console.error('Error verifying TOTP:', error);
        res.status(500).json({ error: 'Failed to verify TOTP' });
    }
});

// Regenerate backup codes (requires 2FA to be enabled)
router.post('/regenerate-backup-codes', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Check that 2FA is currently enabled
        const enabled = await db.twoFactor.isEnabled(userId);
        if (!enabled) {
            return res.status(400).json({ error: '2FA is not enabled' });
        }

        // Generate 10 new backup codes
        const crypto = require('crypto');
        const backupCodes = [];
        for (let i = 0; i < 10; i++) {
            backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
        }

        // Replace existing backup codes (invalidates all previous ones)
        await db.settings.set('two_factor_backup_codes', JSON.stringify(backupCodes), userId, 'security');

        res.json({
            success: true,
            message: 'New backup codes generated. Previous codes are now invalid.',
            backupCodes: backupCodes
        });
    } catch (error) {
        console.error('Error regenerating backup codes:', error);
        res.status(500).json({ error: 'Failed to regenerate backup codes' });
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
        const [allUsersVal, adminsOnlyVal, gracePeriodVal] = await Promise.all([
            db.settings.get('enforce-2fa-all-users'),
            db.settings.get('enforce-2fa-admins-only'),
            db.settings.get('two-factor-grace-period')
        ]);

        const enforce2faAllUsers = allUsersVal === 'true';
        const enforce2faAdminsOnly = adminsOnlyVal === 'true';
        const twoFAGracePeriod = parseInt(gracePeriodVal) || 7;

        // Count users with 2FA enabled
        const usersWithTFA = await db.settings.countUsersWithSetting('two_factor_enabled', 'true');

        // Determine mode
        let mode = 'none';
        if (enforce2faAllUsers) {
            mode = 'all-users';
        } else if (enforce2faAdminsOnly) {
            mode = 'admins-only';
        }

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

        const users = await db.twoFactor.getAllUserStatus();

        res.json({
            success: true,
            users: users || []
        });
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

        // Look up user for notification context
        const user = await db.users.findById(targetUserId);

        // Delete all 2FA-related settings including enrollment_required flag
        await db.settings.deleteByKeys(
            ['two_factor_secret', 'two_factor_backup_codes', 'two_factor_enabled', 'two_factor_enrollment_required'],
            targetUserId
        );

        // Log activity
        await db.activityLog.create(
            req.user.id,
            '2FA_RESET_ADMIN',
            `Admin reset 2FA for user ${targetUserId}`
        );

        // Send security notification for 2FA reset
        const { sendNotification } = require('./notifications');
        sendNotification('security', {
            securityEvent: '2FA Reset',
            username: user ? user.name : targetUserId,
            email: user ? user.email : '',
            performedBy: req.user.email,
            severity: 'High'
        }).catch(err => console.error('Security notification error:', err));

        res.json({
            success: true,
            message: user
                ? `2FA has been reset for ${user.name}`
                : 'User 2FA has been reset'
        });
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
        await db.settings.set('two_factor_enrollment_required', 'true', targetUserId, 'security');

        // Log activity
        await db.activityLog.create(
            req.user.id,
            '2FA_FORCE_ENROLL_ADMIN',
            `Admin forced 2FA enrollment for user ${targetUserId}`
        );

        res.json({
            success: true,
            message: 'User will be required to enroll 2FA on next login'
        });
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
        await db.settings.deleteByKeys(
            ['two_factor_secret', 'two_factor_backup_codes', 'two_factor_enabled', 'two_factor_enrollment_required'],
            targetUserId
        );

        // Log activity
        await db.activityLog.create(
            req.user.id,
            '2FA_UNENROLL_ADMIN',
            `Admin unenrolled user ${targetUserId} from 2FA`
        );

        res.json({
            success: true,
            message: 'User has been unenrolled from 2FA'
        });
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

        const user = await db.users.findById(targetUserId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get 2FA settings
        const settingsRows = await db.settings.getByKeys(
            ['two_factor_enabled', 'two_factor_secret', 'two_factor_backup_codes', 'two_factor_enrollment_required'],
            targetUserId
        );

        let twoFactorEnabled = false;
        let backupCodesCount = 0;
        let enrollmentRequired = false;

        if (settingsRows) {
            settingsRows.forEach(setting => {
                if (setting.key === 'two_factor_enabled') {
                    twoFactorEnabled = setting.value === 'true';
                } else if (setting.key === 'two_factor_backup_codes') {
                    try {
                        const codes = setting.value.split(',');
                        backupCodesCount = Array.isArray(codes) ? codes.length : 0;
                    } catch (e) {
                        backupCodesCount = 0;
                    }
                } else if (setting.key === 'two_factor_enrollment_required') {
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
    } catch (error) {
        console.error('Error getting user 2FA details:', error);
        res.status(500).json({ error: 'Failed to get user 2FA details' });
    }
});

module.exports = router;
