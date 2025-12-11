const nodemailer = require('nodemailer');

const getDb = () => global.db;

// Helper to get a setting value
const getSetting = async (key, userId = null) => {
  return new Promise((resolve, reject) => {
    let query = 'SELECT value FROM settings WHERE key = ?';
    let params = [key];
    
    if (userId) {
      query += ' AND (user_id = ? OR user_id IS NULL) ORDER BY user_id DESC LIMIT 1';
      params = [key, userId];
    } else {
      query += ' AND user_id IS NULL LIMIT 1';
    }
    
    getDb().get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row?.value || null);
    });
  });
};

// Get list of admin emails
const getAdminEmails = async () => {
  return new Promise((resolve, reject) => {
    getDb().all(
      'SELECT email FROM users WHERE role = ? AND is_active = ?',
      ['admin', true],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows?.map(r => r.email) || []);
      }
    );
  });
};

// Send notification via SMTP
const sendSmtpNotification = async (event, eventData, adminEmails, ccEmail) => {
  try {
    const smtpServer = await getSetting('smtp-server');
    const smtpPort = await getSetting('smtp-port');
    const smtpUsername = await getSetting('smtp-username');
    const smtpPassword = await getSetting('smtp-password');
    const smtpUseTls = await getSetting('smtp-use-tls');

    if (!smtpServer || !smtpPort || !smtpUsername || !smtpPassword) {
      console.log('SMTP configuration incomplete, skipping notification');
      return;
    }

    const port = parseInt(smtpPort);
    const transporter = nodemailer.createTransport({
      host: smtpServer,
      port: port,
      secure: port === 465,
      auth: {
        user: smtpUsername,
        pass: smtpPassword
      },
      tls: {
        rejectUnauthorized: false,
        ciphers: 'SSLv3'
      },
      requireTLS: smtpUseTls === 'true'
    });

    // Build email based on event type
    const emailContent = buildEmailContent(event, eventData);
    
    // Build recipient list
    let recipients = [...adminEmails];
    if (ccEmail && ccEmail.trim()) {
      recipients.push(ccEmail);
    }

    const mailOptions = {
      from: smtpUsername,
      to: recipients.join(','),
      subject: emailContent.subject,
      html: emailContent.html
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`Notification email sent for ${event}:`, result.messageId);
    return result;

  } catch (error) {
    console.error(`Failed to send SMTP notification for ${event}:`, error);
  }
};

// Send notification via Discord
const sendDiscordNotification = async (event, eventData, webhookUrl, botUsername) => {
  try {
    if (!webhookUrl) {
      console.log('Discord webhook not configured');
      return;
    }

    const axios = require('axios');
    const message = buildDiscordMessage(event, eventData, botUsername);

    await axios.post(webhookUrl, {
      username: botUsername || 'Landio Bot',
      embeds: [
        {
          title: getEventTitle(event),
          description: message,
          color: getEventColor(event),
          timestamp: new Date().toISOString()
        }
      ]
    });

    console.log(`Discord notification sent for ${event}`);

  } catch (error) {
    console.error(`Failed to send Discord notification for ${event}:`, error.message);
  }
};

// Main notification function
const sendNotification = async (event, eventData = {}) => {
  try {
    // Check if this event type is enabled
    const enableKey = getEventEnabledKey(event);
    const isEventEnabled = await getSetting(enableKey);
    
    console.log(`[Notification] Event: ${event}, EnableKey: ${enableKey}, IsEnabled: ${isEventEnabled}`);
    
    if (isEventEnabled !== 'true') {
      console.log(`Event notifications disabled for ${event} (${enableKey}=${isEventEnabled})`);
      return;
    }

    // Check if application notifications are enabled
    const appNotificationsEnabled = await getSetting('enable-app-notifications');
    const userNotificationsEnabled = await getSetting('enable-user-notifications');

    const isAppEvent = ['login', 'logout', 'app-start', 'app-stop', 'app-restart', 'errors'].includes(event);
    const isUserEvent = ['security', 'user-activity'].includes(event);

    console.log(`[Notification] AppNotif: ${appNotificationsEnabled}, UserNotif: ${userNotificationsEnabled}, IsApp: ${isAppEvent}, IsUser: ${isUserEvent}`);

    if (isAppEvent && appNotificationsEnabled !== 'true') {
      console.log('Application notifications disabled');
      return;
    }

    if (isUserEvent && userNotificationsEnabled !== 'true') {
      console.log('User notifications disabled');
      return;
    }

    // Check if SMTP is enabled
    const smtpEnabled = await getSetting('smtp-enabled');
    const adminEmails = smtpEnabled === 'true' ? await getAdminEmails() : [];
    const ccEmail = smtpEnabled === 'true' ? await getSetting('alert-cc-email') : null;

    console.log(`[Notification] SMTP enabled: ${smtpEnabled}, Admin emails: ${adminEmails.length}`);

    if (smtpEnabled === 'true' && adminEmails.length > 0) {
      await sendSmtpNotification(event, eventData, adminEmails, ccEmail);
    }

    // Check if Discord is enabled
    const discordEnabled = await getSetting('discord-enabled');
    const webhookUrl = await getSetting('discord-webhook');
    const botUsername = await getSetting('discord-username');
    
    console.log(`[Notification] Discord enabled: ${discordEnabled}, Webhook: ${webhookUrl ? 'configured' : 'missing'}`);
    
    if (discordEnabled === 'true') {
      await sendDiscordNotification(event, eventData, webhookUrl, botUsername);
    }

  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

// Helper functions
const getEventEnabledKey = (event) => {
  return `notify-${event}`;
};

const getEventTitle = (event) => {
  const titles = {
    'login': 'User Login',
    'logout': 'User Logout',
    'app-start': 'Application Started',
    'app-stop': 'Application Stopped',
    'app-restart': 'Application Restarted',
    'errors': 'System Error',
    'security': 'Security Alert',
    'user-activity': 'User Activity'
  };
  return titles[event] || event;
};

const getEventColor = (event) => {
  const colors = {
    'login': 3447003, // Blue
    'logout': 16776960, // Yellow
    'app-start': 65280, // Green
    'app-stop': 16711680, // Red
    'app-restart': 16776960, // Yellow
    'errors': 16711680, // Red
    'security': 16711680, // Red
    'user-activity': 3447003 // Blue
  };
  return colors[event] || 9807270;
};

const buildEmailContent = (event, eventData) => {
  const timestamp = new Date().toLocaleString();
  
  let subject = '';
  let html = '';
  
  switch(event) {
    case 'login':
      subject = 'User Login Alert';
      html = `
        <h2>User Login Detected</h2>
        <p>A user has logged into the system.</p>
        <ul>
          <li><strong>Username:</strong> ${eventData.username || 'N/A'}</li>
          <li><strong>Email:</strong> ${eventData.email || 'N/A'}</li>
          <li><strong>Time:</strong> ${timestamp}</li>
          <li><strong>IP Address:</strong> ${eventData.ipAddress || 'N/A'}</li>
        </ul>
      `;
      break;
    
    case 'logout':
      subject = 'User Logout Alert';
      html = `
        <h2>User Logout Detected</h2>
        <p>A user has logged out of the system.</p>
        <ul>
          <li><strong>Username:</strong> ${eventData.username || 'N/A'}</li>
          <li><strong>Email:</strong> ${eventData.email || 'N/A'}</li>
          <li><strong>Time:</strong> ${timestamp}</li>
        </ul>
      `;
      break;
    
    case 'app-start':
      subject = 'Application Started';
      html = `
        <h2>Application Started</h2>
        <p>The Landio Dashboard has been started.</p>
        <ul>
          <li><strong>Time:</strong> ${timestamp}</li>
        </ul>
      `;
      break;
    
    case 'app-stop':
      subject = 'Application Stopped';
      html = `
        <h2>Application Stopped</h2>
        <p>The Landio Dashboard has been stopped.</p>
        <ul>
          <li><strong>Time:</strong> ${timestamp}</li>
        </ul>
      `;
      break;
    
    case 'app-restart':
      subject = 'Application Restarted';
      html = `
        <h2>Application Restarted</h2>
        <p>The Landio Dashboard has been restarted.</p>
        <ul>
          <li><strong>Time:</strong> ${timestamp}</li>
        </ul>
      `;
      break;
    
    case 'errors':
      subject = 'System Error Alert';
      html = `
        <h2>System Error Detected</h2>
        <p>An error has occurred in the system.</p>
        <ul>
          <li><strong>Error:</strong> ${eventData.error || 'N/A'}</li>
          <li><strong>Timestamp:</strong> ${timestamp}</li>
          <li><strong>Component:</strong> ${eventData.component || 'N/A'}</li>
        </ul>
      `;
      break;
    
    case 'security':
      subject = 'Security Alert';
      html = `
        <h2>Security Alert</h2>
        <p>A security event has been detected.</p>
        <ul>
          <li><strong>Event:</strong> ${eventData.securityEvent || 'N/A'}</li>
          <li><strong>User:</strong> ${eventData.username || 'N/A'}</li>
          <li><strong>Email:</strong> ${eventData.email || 'N/A'}</li>
          <li><strong>Timestamp:</strong> ${timestamp}</li>
          <li><strong>IP Address:</strong> ${eventData.ipAddress || 'N/A'}</li>
          <li><strong>Severity:</strong> ${eventData.severity || 'Medium'}</li>
          ${eventData.performedBy ? `<li><strong>Performed By:</strong> ${eventData.performedBy}</li>` : ''}
        </ul>
      `;
      break;
    
    case 'user-activity':
      subject = 'User Activity Notification';
      html = `
        <h2>User Activity Notification</h2>
        <p>User account activity has been detected.</p>
        <ul>
          <li><strong>User:</strong> ${eventData.username || 'N/A'}</li>
          <li><strong>Activity:</strong> ${eventData.activity || 'N/A'}</li>
          <li><strong>Timestamp:</strong> ${timestamp}</li>
          ${eventData.performedBy ? `<li><strong>Performed By:</strong> ${eventData.performedBy}</li>` : ''}
        </ul>
      `;
      break;
    
    default:
      subject = 'System Notification';
      html = `<h2>${event}</h2><p>An event has occurred.</p>`;
  }
  
  // Wrap in template
  html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; color: white; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0;">Landio Dashboard Notification</h1>
      </div>
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
        ${html}
      </div>
    </div>
  `;
  
  return { subject, html };
};

const buildDiscordMessage = (event, eventData, botUsername) => {
  const timestamp = new Date().toLocaleString();
  
  switch(event) {
    case 'login':
      return `**User Login Detected**\n\nUser: ${eventData.username || 'N/A'}\nEmail: ${eventData.email || 'N/A'}\nTime: ${timestamp}\nIP: ${eventData.ipAddress || 'N/A'}`;
    case 'logout':
      return `**User Logout Detected**\n\nUser: ${eventData.username || 'N/A'}\nEmail: ${eventData.email || 'N/A'}\nTime: ${timestamp}`;
    case 'app-start':
      return `**Application Started**\n\nTime: ${timestamp}`;
    case 'app-stop':
      return `**Application Stopped**\n\nTime: ${timestamp}`;
    case 'app-restart':
      return `**Application Restarted**\n\nTime: ${timestamp}`;
    case 'errors':
      return `**System Error**\n\nError: ${eventData.error || 'N/A'}\nComponent: ${eventData.component || 'N/A'}\nTime: ${timestamp}`;
    case 'security':
      return `**Security Alert**\n\nEvent: ${eventData.securityEvent || 'N/A'}\nIP: ${eventData.ipAddress || 'N/A'}\nSeverity: ${eventData.severity || 'Medium'}\nTime: ${timestamp}`;
    case 'user-activity':
      return `**User Activity**\n\nUser: ${eventData.username || 'N/A'}\nActivity: ${eventData.activity || 'N/A'}\nTime: ${timestamp}`;
    default:
      return `**${event}**\n\nTime: ${timestamp}`;
  }
};

module.exports = {
  sendNotification,
  sendSmtpNotification,
  sendDiscordNotification
};
