const express = require('express');
const router = express.Router();

// Get db from global scope instead of requiring server
const getDb = () => global.db;

// Import authenticateToken from auth routes
const authRoutes = require('./auth');
const authenticateToken = authRoutes.authenticateToken;

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// GET /api/settings - Get all settings (system + user-specific)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get system settings (user_id = NULL)
    const systemSettings = await new Promise((resolve, reject) => {
      getDb().all(
        'SELECT key, value, category FROM settings WHERE user_id IS NULL',
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Get user-specific settings
    const userSettings = await new Promise((resolve, reject) => {
      getDb().all(
        'SELECT key, value, category FROM settings WHERE user_id = ?',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Merge settings (user settings override system settings)
    const settingsMap = {};
    
    systemSettings.forEach(setting => {
      settingsMap[setting.key] = {
        value: setting.value,
        category: setting.category,
        scope: 'system'
      };
    });

    userSettings.forEach(setting => {
      settingsMap[setting.key] = {
        value: setting.value,
        category: setting.category,
        scope: 'user'
      };
    });

    res.json({ settings: settingsMap });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// GET /api/settings/:key - Get specific setting
router.get('/:key', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const key = req.params.key;

    // First try to get user-specific setting
    const userSetting = await new Promise((resolve, reject) => {
      getDb().get(
        'SELECT value, category FROM settings WHERE user_id = ? AND key = ?',
        [userId, key],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (userSetting) {
      return res.json({ 
        key, 
        value: userSetting.value, 
        category: userSetting.category,
        scope: 'user'
      });
    }

    // Fall back to system setting
    const systemSetting = await new Promise((resolve, reject) => {
      getDb().get(
        'SELECT value, category FROM settings WHERE user_id IS NULL AND key = ?',
        [key],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (systemSetting) {
      return res.json({ 
        key, 
        value: systemSetting.value, 
        category: systemSetting.category,
        scope: 'system'
      });
    }

    res.status(404).json({ error: 'Setting not found' });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// PUT /api/settings - Update multiple settings
router.put('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { settings, scope = 'user' } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Invalid settings data' });
    }

    // Only admins can update system settings
    if (scope === 'system' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required for system settings' });
    }

    const targetUserId = scope === 'system' ? null : userId;

    // Update each setting
    const stmt = getDb().prepare(`
      INSERT INTO settings (user_id, key, value, category, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `);

    for (const [key, data] of Object.entries(settings)) {
      const value = typeof data === 'object' ? data.value : data;
      const category = typeof data === 'object' ? data.category : null;
      
      await new Promise((resolve, reject) => {
        stmt.run(targetUserId, key, String(value), category, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    stmt.finalize();

    res.json({ 
      success: true, 
      message: 'Settings updated successfully',
      count: Object.keys(settings).length
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// PUT /api/settings/:key - Update specific setting
router.put('/:key', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const key = req.params.key;
    const { value, category, scope = 'user' } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'Value is required' });
    }

    // Only admins can update system settings
    if (scope === 'system' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required for system settings' });
    }

    const targetUserId = scope === 'system' ? null : userId;

    await new Promise((resolve, reject) => {
      getDb().run(`
        INSERT INTO settings (user_id, key, value, category, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, key) DO UPDATE SET
          value = excluded.value,
          category = excluded.category,
          updated_at = datetime('now')
      `, [targetUserId, key, String(value), category], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({ 
      success: true, 
      message: 'Setting updated successfully',
      key,
      value
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// POST /api/settings - Create/update a single setting
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { key, value, category = 'general', scope = 'user' } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key and value are required' });
    }

    // Only admins can create/update system settings
    if (scope === 'system' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required for system settings' });
    }

    const targetUserId = scope === 'system' ? null : userId;

    await new Promise((resolve, reject) => {
      getDb().run(`
        INSERT INTO settings (user_id, key, value, category, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, key) DO UPDATE SET
          value = excluded.value,
          category = excluded.category,
          updated_at = datetime('now')
      `, [targetUserId, key, String(value), category], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({ 
      success: true, 
      message: 'Setting created/updated successfully',
      key,
      value,
      category
    });
  } catch (error) {
    console.error('Error creating/updating setting:', error);
    res.status(500).json({ error: 'Failed to create/update setting' });
  }
});

// DELETE /api/settings/:key - Delete specific setting (admin only for system, users can delete their own)
router.delete('/:key', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const key = req.params.key;
    const { scope = 'user' } = req.body;

    // Only admins can delete system settings
    if (scope === 'system' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required for system settings' });
    }

    const targetUserId = scope === 'system' ? null : userId;

    await new Promise((resolve, reject) => {
      getDb().run(
        'DELETE FROM settings WHERE user_id IS ? AND key = ?',
        [targetUserId, key],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ 
      success: true, 
      message: 'Setting deleted successfully',
      key
    });
  } catch (error) {
    console.error('Error deleting setting:', error);
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

// POST /api/settings/test-smtp - Test SMTP configuration (admin only)
router.post('/test-smtp', authenticateToken, async (req, res) => {
  try {
    // Only admins can test SMTP
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get SMTP settings
    const db = getDb();
    const getSmtpSetting = (key) => {
      return new Promise((resolve, reject) => {
        // Try user settings first, then system settings
        db.get(
          'SELECT value FROM settings WHERE key = ? AND user_id = ? UNION SELECT value FROM settings WHERE key = ? AND user_id IS NULL LIMIT 1',
          [key, req.user.id, key],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.value || null);
          }
        );
      });
    };

    const smtpServer = await getSmtpSetting('smtp-server');
    const smtpPort = await getSmtpSetting('smtp-port');
    const smtpUsername = await getSmtpSetting('smtp-username');
    const smtpPassword = await getSmtpSetting('smtp-password');
    const smtpUseTls = await getSmtpSetting('smtp-use-tls');

    console.log('SMTP Settings retrieved:', { smtpServer, smtpPort, smtpUsername: smtpUsername ? '***' : 'missing', smtpPassword: smtpPassword ? '***' : 'missing', smtpUseTls });

    // Validate settings
    if (!smtpServer || !smtpPort || !smtpUsername || !smtpPassword) {
      console.log('SMTP configuration incomplete for user', req.user.id);
      return res.status(400).json({ 
        error: 'SMTP configuration incomplete',
        details: {
          server: !smtpServer ? 'missing' : 'ok',
          port: !smtpPort ? 'missing' : 'ok',
          username: !smtpUsername ? 'missing' : 'ok',
          password: !smtpPassword ? 'missing' : 'ok'
        }
      });
    }

    try {
      const nodemailer = require('nodemailer');

      // Create transporter
      const port = parseInt(smtpPort);
      const transporter = nodemailer.createTransport({
        host: smtpServer,
        port: port,
        secure: port === 465, // true for 465 (SSL), false for 587 (STARTTLS)
        auth: {
          user: smtpUsername,
          pass: smtpPassword
        },
        tls: {
          rejectUnauthorized: false, // Allow self-signed certificates
          ciphers: 'SSLv3' // Some servers need this
        },
        requireTLS: smtpUseTls === 'true' // Force STARTTLS for port 587
      });

      // Test connection
      const verified = await transporter.verify();
      
      if (!verified) {
        return res.status(400).json({ 
          error: 'SMTP authentication failed',
          message: 'Could not authenticate with the SMTP server'
        });
      }

      // Send test email to admin
      const testRecipient = req.body.recipient || req.user.email;
      
      const mailOptions = {
        from: smtpUsername,
        to: testRecipient,
        subject: '🧪 SMTP Test - Landio Dashboard',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; color: white; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0;">SMTP Test Email</h1>
              <p style="margin: 5px 0 0 0; opacity: 0.9;">From Landio Dashboard</p>
            </div>
            
            <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
              <h2 style="color: #333;">✅ SMTP Configuration is Working!</h2>
              
              <p>If you're reading this email, your SMTP configuration is correctly set up and functioning.</p>
              
              <div style="background: white; padding: 20px; border-left: 4px solid #667eea; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #667eea;">Configuration Details</h3>
                <ul style="color: #666; line-height: 1.8;">
                  <li><strong>Server:</strong> ${smtpServer}:${smtpPort}</li>
                  <li><strong>TLS/SSL:</strong> ${smtpUseTls === 'true' ? 'Enabled' : 'Disabled'}</li>
                  <li><strong>Test Time:</strong> ${new Date().toLocaleString()}</li>
                </ul>
              </div>
              
              <p style="color: #999; font-size: 12px; margin-top: 30px;">
                This is an automated test email from your Landio Dashboard. 
                If you did not request this email, you can safely ignore it.
              </p>
            </div>
          </div>
        `,
        text: `SMTP Test Email\n\nIf you're reading this, your SMTP configuration is working!\n\nServer: ${smtpServer}:${smtpPort}\nTime: ${new Date().toLocaleString()}`
      };

      const result = await transporter.sendMail(mailOptions);

      res.json({ 
        success: true,
        message: 'SMTP test successful - email sent',
        details: {
          recipient: testRecipient,
          messageId: result.messageId,
          response: result.response,
          timestamp: new Date().toISOString()
        }
      });

    } catch (smtpError) {
      console.error('SMTP test failed:', smtpError.message, 'Code:', smtpError.code);
      res.status(400).json({ 
        error: 'SMTP error',
        message: smtpError.message,
        code: smtpError.code,
        details: smtpError.response || smtpError.responseCode
      });
    }

  } catch (error) {
    console.error('Error testing SMTP:', error);
    res.status(500).json({ error: 'Failed to test SMTP configuration' });
  }
});

// POST /api/settings/test-discord - Test Discord webhook configuration (admin only)
router.post('/test-discord', authenticateToken, async (req, res) => {
  try {
    console.log('Discord test request received:', req.body);
    
    // Only admins can test Discord
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get webhook URL and username from request body or database
    let discordWebhook = req.body.webhookUrl;
    let discordUsername = req.body.botUsername;

    console.log('Webhook from request:', discordWebhook);
    console.log('Username from request:', discordUsername);

    // If not provided in request, try to get from database
    if (!discordWebhook) {
      discordWebhook = await new Promise((resolve, reject) => {
        global.db.get(
          'SELECT value FROM settings WHERE key = ? AND user_id IS NULL LIMIT 1',
          ['discord-webhook'],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.value || null);
          }
        );
      });
    }

    if (!discordUsername) {
      discordUsername = await new Promise((resolve, reject) => {
        global.db.get(
          'SELECT value FROM settings WHERE key = ? AND user_id IS NULL LIMIT 1',
          ['discord-username'],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.value || 'Landio Bot');
          }
        );
      });
    }

    console.log('Final webhook:', discordWebhook);
    console.log('Final username:', discordUsername);

    if (!discordWebhook) {
      return res.status(400).json({ 
        error: 'Discord webhook URL is required',
        details: {
          webhook: 'Please enter a webhook URL'
        }
      });
    }

    try {
      const axios = require('axios');
      
      const testMessage = {
        username: discordUsername || 'Landio Bot',
        content: '🧪 Discord Webhook Test',
        embeds: [
          {
            title: '✅ Discord Integration Test',
            description: 'Your Discord webhook is configured correctly!',
            color: 65280, // Green
            fields: [
              {
                name: 'Test Status',
                value: 'Success',
                inline: true
              },
              {
                name: 'Timestamp',
                value: new Date().toLocaleString(),
                inline: true
              },
              {
                name: 'Bot Name',
                value: discordUsername || 'Landio Bot',
                inline: false
              }
            ],
            footer: {
              text: 'Landio Dashboard'
            },
            timestamp: new Date().toISOString()
          }
        ]
      };

      const result = await axios.post(discordWebhook, testMessage);

      res.json({ 
        success: true,
        message: 'Discord test successful - message sent to webhook',
        details: {
          webhook: discordWebhook.substring(0, 50) + '...',
          botName: discordUsername || 'Landio Bot',
          timestamp: new Date().toISOString()
        }
      });

    } catch (discordError) {
      console.error('Discord test failed:', discordError.message);
      res.status(400).json({ 
        error: 'Discord webhook error',
        message: discordError.message,
        details: discordError.response?.status || 'Unknown error'
      });
    }

  } catch (error) {
    console.error('Error testing Discord:', error);
    res.status(500).json({ error: 'Failed to test Discord configuration' });
  }
});

// GET /api/settings/theme/preferences - Get user's theme preferences
router.get('/theme/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const themePreferences = await new Promise((resolve, reject) => {
      getDb().all(
        `SELECT key, value FROM settings 
         WHERE user_id = ? AND key IN (
           'theme-preference', 'selected-theme', 'font-size', 
           'high-contrast', 'reduce-motion', 'animations-enabled'
         )`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Convert to object format
    const preferences = {};
    themePreferences.forEach(pref => {
      if (pref.key === 'high-contrast' || pref.key === 'reduce-motion' || pref.key === 'animations-enabled') {
        preferences[pref.key] = pref.value === 'true';
      } else {
        preferences[pref.key] = pref.value;
      }
    });

    res.json({ 
      preferences: {
        isDarkMode: preferences['theme-preference'] === 'dark',
        theme: preferences['selected-theme'] || 'pastel',
        fontSize: preferences['font-size'] || 'medium',
        highContrast: preferences['high-contrast'] || false,
        reduceMotion: preferences['reduce-motion'] || false,
        animations: preferences['animations-enabled'] !== false
      }
    });
  } catch (error) {
    console.error('Error fetching theme preferences:', error);
    res.status(500).json({ error: 'Failed to fetch theme preferences' });
  }
});

// POST /api/settings/theme/preferences - Save user's theme preferences
router.post('/theme/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { isDarkMode, theme, fontSize, highContrast, reduceMotion, animations } = req.body;

    // Validate inputs
    if (isDarkMode === undefined && !theme && !fontSize && highContrast === undefined && reduceMotion === undefined && animations === undefined) {
      return res.status(400).json({ error: 'At least one preference must be provided' });
    }

    // Valid theme options
    const validThemes = ['pastel', 'cyber', 'mocha', 'ice', 'nature', 'sunset'];
    const validFontSizes = ['small', 'medium', 'large', 'extra-large'];

    if (theme && !validThemes.includes(theme)) {
      return res.status(400).json({ error: `Invalid theme. Must be one of: ${validThemes.join(', ')}` });
    }

    if (fontSize && !validFontSizes.includes(fontSize)) {
      return res.status(400).json({ error: `Invalid font size. Must be one of: ${validFontSizes.join(', ')}` });
    }

    const updates = [];

    if (isDarkMode !== undefined) {
      updates.push(['theme-preference', isDarkMode ? 'dark' : 'light']);
    }
    if (theme) {
      updates.push(['selected-theme', theme]);
    }
    if (fontSize) {
      updates.push(['font-size', fontSize]);
    }
    if (highContrast !== undefined) {
      updates.push(['high-contrast', highContrast.toString()]);
    }
    if (reduceMotion !== undefined) {
      updates.push(['reduce-motion', reduceMotion.toString()]);
    }
    if (animations !== undefined) {
      updates.push(['animations-enabled', animations.toString()]);
    }

    // Save all preferences
    for (const [key, value] of updates) {
      await new Promise((resolve, reject) => {
        getDb().run(`
          INSERT INTO settings (user_id, key, value, category, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id, key) DO UPDATE SET
            value = excluded.value,
            updated_at = datetime('now')
        `, [userId, key, value, 'appearance'], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    res.json({ 
      success: true, 
      message: 'Theme preferences saved successfully',
      preferences: {
        isDarkMode,
        theme,
        fontSize,
        highContrast,
        reduceMotion,
        animations
      }
    });
  } catch (error) {
    console.error('Error saving theme preferences:', error);
    res.status(500).json({ error: 'Failed to save theme preferences' });
  }
});

module.exports = router;

