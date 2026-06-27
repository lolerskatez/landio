const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin, requireAdminOrPowerUser } = require('../middleware/auth');
const {
  getSystemInfo,
  getPendingOperation,
  cancelOperation,
  scheduleSystemAction,
  executeSystemAction,
} = require('../lib/system');

const { sendNotification } = require('./notifications');

// Helper to get db
const getDb = () => global.db;

/**
 * Helper to log actions to the activity log.
 */
async function auditLog(userId, action, details, ipAddress, userAgent) {
  try {
    const db = getDb();
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO activity_log (user_id, action, details, ip_address, user_agent, timestamp) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
        [userId, action, JSON.stringify(details), ipAddress, userAgent],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

/**
 * Helper to check if a setting is enabled.
 */
async function isSettingEnabled(key, defaultValue = 'true') {
  try {
    const db = getDb();
    const row = await new Promise((resolve, reject) => {
      db.get(
        'SELECT value FROM settings WHERE user_id IS NULL AND key = ?',
        [key],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    return row ? row.value === 'true' : defaultValue === 'true';
  } catch {
    return defaultValue === 'true';
  }
}

// ─── System Information ───────────────────────────────────────────────────────

// GET /api/system/info - Get comprehensive system information
router.get('/info', authenticateToken, requireAdminOrPowerUser, async (req, res) => {
  try {
    const info = await getSystemInfo();

    // Power users get non-sensitive info
    if (req.user.role !== 'admin') {
      // Show basic info only
      const { hostname, platform, os, arch, uptime, uptimeHuman, isContainer, cpuModel, cpuCores, loadAvg, memory, disk, timestamp } = info;
      return res.json({
        hostname, platform, os, arch, uptime, uptimeHuman, isContainer,
        cpuModel, cpuCores, loadAvg, memory, disk, timestamp,
      });
    }

    res.json(info);
  } catch (error) {
    console.error('Error getting system info:', error);
    res.status(500).json({ error: 'Failed to get system information' });
  }
});

// ─── Reboot Operations ────────────────────────────────────────────────────────

// POST /api/system/reboot - Schedule system reboot (admin only)
router.post('/reboot', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Check if reboot is enabled
    const rebootEnabled = await isSettingEnabled('system-reboot-enabled', 'true');
    if (!rebootEnabled) {
      return res.status(403).json({ error: 'Reboot functionality is disabled by administrator' });
    }

    const delay = req.body.delay || 60;
    const reason = req.body.reason || '';

    // Require reason if setting is enabled
    const requireReason = await isSettingEnabled('system-reboot-require-reason', 'true');
    if (requireReason && !reason.trim()) {
      return res.status(400).json({ error: 'Reason is required for reboot' });
    }

    // Validate delay
    const validDelay = Math.max(10, Math.min(600, delay)); // 10s - 600s (10 min)

    // Schedule the reboot
    const result = await scheduleSystemAction('reboot', req.user.name || req.user.username, {
      delay: validDelay,
      reason: reason,
    });

    // Audit log
    await auditLog(req.user.id, 'system-reboot', {
      scheduledAt: result.scheduledAt,
      delay: validDelay,
      reason: reason,
      cancelToken: result.cancelToken,
    }, req.ip, req.headers['user-agent']);

    // Send notification
    sendNotification('system-reboot', {
      triggeredBy: req.user.name || req.user.username,
      scheduledAt: result.scheduledAt,
      delay: validDelay,
      reason: reason,
      ipAddress: req.ip,
    }).catch(err => console.error('Reboot notification error:', err));

    res.json({
      success: true,
      message: `System reboot scheduled in ${validDelay} seconds`,
      scheduledAt: result.scheduledAt,
      delay: validDelay,
      cancelToken: result.cancelToken,
    });
  } catch (error) {
    console.error('Error scheduling reboot:', error);
    res.status(500).json({ error: 'Failed to schedule reboot' });
  }
});

// POST /api/system/reboot/cancel - Cancel pending reboot
router.post('/reboot/cancel', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const token = req.body.token;
    if (!token) {
      return res.status(400).json({ error: 'Cancel token is required' });
    }

    const cancelled = cancelOperation(token);
    if (cancelled) {
      // Audit log
      await auditLog(req.user.id, 'system-reboot-cancel', {
        cancelledAt: new Date().toISOString(),
      }, req.ip, req.headers['user-agent']);

      res.json({ success: true, message: 'Pending reboot has been cancelled' });
    } else {
      res.status(404).json({ error: 'No pending operation found with that token' });
    }
  } catch (error) {
    console.error('Error cancelling reboot:', error);
    res.status(500).json({ error: 'Failed to cancel reboot' });
  }
});

// ─── Shutdown Operations ──────────────────────────────────────────────────────

// POST /api/system/shutdown - Schedule system shutdown (admin only)
router.post('/shutdown', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Check if shutdown is enabled
    const shutdownEnabled = await isSettingEnabled('system-shutdown-enabled', 'true');
    if (!shutdownEnabled) {
      return res.status(403).json({ error: 'Shutdown functionality is disabled by administrator' });
    }

    const delay = req.body.delay || 60;
    const reason = req.body.reason || '';

    // Require reason if setting is enabled
    const requireReason = await isSettingEnabled('system-reboot-require-reason', 'true');
    if (requireReason && !reason.trim()) {
      return res.status(400).json({ error: 'Reason is required for shutdown' });
    }

    // Validate delay
    const validDelay = Math.max(10, Math.min(600, delay));

    // Schedule the shutdown
    const result = await scheduleSystemAction('shutdown', req.user.name || req.user.username, {
      delay: validDelay,
      reason: reason,
    });

    // Audit log
    await auditLog(req.user.id, 'system-shutdown', {
      scheduledAt: result.scheduledAt,
      delay: validDelay,
      reason: reason,
      cancelToken: result.cancelToken,
    }, req.ip, req.headers['user-agent']);

    // Send notification
    sendNotification('system-shutdown', {
      triggeredBy: req.user.name || req.user.username,
      scheduledAt: result.scheduledAt,
      delay: validDelay,
      reason: reason,
      ipAddress: req.ip,
    }).catch(err => console.error('Shutdown notification error:', err));

    res.json({
      success: true,
      message: `System shutdown scheduled in ${validDelay} seconds`,
      scheduledAt: result.scheduledAt,
      delay: validDelay,
      cancelToken: result.cancelToken,
    });
  } catch (error) {
    console.error('Error scheduling shutdown:', error);
    res.status(500).json({ error: 'Failed to schedule shutdown' });
  }
});

// POST /api/system/shutdown/cancel - Cancel pending shutdown
router.post('/shutdown/cancel', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const token = req.body.token;
    if (!token) {
      return res.status(400).json({ error: 'Cancel token is required' });
    }

    const cancelled = cancelOperation(token);
    if (cancelled) {
      // Audit log
      await auditLog(req.user.id, 'system-shutdown-cancel', {
        cancelledAt: new Date().toISOString(),
      }, req.ip, req.headers['user-agent']);

      res.json({ success: true, message: 'Pending shutdown has been cancelled' });
    } else {
      res.status(404).json({ error: 'No pending operation found with that token' });
    }
  } catch (error) {
    console.error('Error cancelling shutdown:', error);
    res.status(500).json({ error: 'Failed to cancel shutdown' });
  }
});

// ─── Status ───────────────────────────────────────────────────────────────────

// GET /api/system/status - Get current pending operation status
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const op = getPendingOperation();

    if (!op || op.executed) {
      return res.json({
        pending: false,
        message: 'No pending operation',
      });
    }

    // Calculate remaining time
    const elapsed = (Date.now() - new Date(op.scheduledAt).getTime()) / 1000;
    const remaining = Math.max(0, op.delay - elapsed);

    res.json({
      pending: true,
      action: op.action,
      triggeredBy: op.triggeredBy,
      reason: op.reason,
      delay: op.delay,
      remaining: Math.round(remaining),
      scheduledAt: op.scheduledAt,
      cancelled: op.cancelled,
    });
  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({ error: 'Failed to get system status' });
  }
});

module.exports = router;
