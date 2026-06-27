const express = require('express');
const router = express.Router();
const db = require('../lib/datalayer');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * GET /api/logs — Retrieve activity logs with filtering and pagination.
 *
 * Query params:
 *   page       (int, default 1)
 *   limit      (int, default 50, max 200)
 *   user_id    (int, optional)   — filter by user ID
 *   action     (string, optional) — filter by action type
 *   date_from  (ISO string, optional) — start date (inclusive)
 *   date_to    (ISO string, optional) — end date (inclusive)
 *   search     (string, optional) — full-text search in details column
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (req.query.user_id) {
      conditions.push('al.user_id = ?');
      params.push(parseInt(req.query.user_id));
    }

    if (req.query.action) {
      conditions.push('al.action = ?');
      params.push(req.query.action);
    }

    if (req.query.date_from) {
      conditions.push('al.timestamp >= ?');
      params.push(req.query.date_from);
    }

    if (req.query.date_to) {
      conditions.push('al.timestamp <= ?');
      params.push(req.query.date_to);
    }

    if (req.query.search) {
      conditions.push('al.details LIKE ?');
      params.push(`%${req.query.search}%`);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Get total count
    const countRow = await db.get(
      `SELECT COUNT(*) as count FROM activity_log al ${whereClause}`,
      params
    );
    const total = countRow ? countRow.count : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // Get paginated results with username join
    const logs = await db.all(
      `SELECT al.id, al.user_id, COALESCE(u.username, '') as username,
              COALESCE(u.name, '') as user_name,
              al.action, al.details, al.ip_address, al.user_agent, al.timestamp
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereClause}
       ORDER BY al.timestamp DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

/**
 * DELETE /api/logs — Clear all activity logs (admin only).
 * Logs the clear action itself before deleting the table.
 */
router.delete('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Log the clear action before deleting (in case this entry survives)
    await db.activityLog.create(
      req.user.id,
      'clear_logs',
      `Activity log cleared by ${req.user.name || req.user.email}`,
      req.ip,
      req.get('User-Agent')
    );

    // Clear the table
    await db.run('DELETE FROM activity_log');

    res.json({ message: 'Activity log cleared successfully' });
  } catch (error) {
    console.error('Error clearing activity logs:', error);
    res.status(500).json({ error: 'Failed to clear activity logs' });
  }
});

/**
 * GET /api/logs/export — Export activity logs as CSV or JSON.
 *
 * Query params:
 *   format     (string, 'json' or 'csv', default 'json')
 *   user_id, action, date_from, date_to, search — same as GET /
 */
router.get('/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const format = (req.query.format || 'json').toLowerCase();

    const conditions = [];
    const params = [];

    if (req.query.user_id) {
      conditions.push('al.user_id = ?');
      params.push(parseInt(req.query.user_id));
    }

    if (req.query.action) {
      conditions.push('al.action = ?');
      params.push(req.query.action);
    }

    if (req.query.date_from) {
      conditions.push('al.timestamp >= ?');
      params.push(req.query.date_from);
    }

    if (req.query.date_to) {
      conditions.push('al.timestamp <= ?');
      params.push(req.query.date_to);
    }

    if (req.query.search) {
      conditions.push('al.details LIKE ?');
      params.push(`%${req.query.search}%`);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const logs = await db.all(
      `SELECT al.id, al.user_id, COALESCE(u.username, '') as username,
              COALESCE(u.name, '') as user_name,
              al.action, al.details, al.ip_address, al.user_agent, al.timestamp
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereClause}
       ORDER BY al.timestamp DESC`,
      params
    );

    if (format === 'csv') {
      const headers = ['ID', 'User ID', 'Username', 'User Name', 'Action', 'Details', 'IP Address', 'User Agent', 'Timestamp'];
      const csvRows = logs.map(log => [
        log.id,
        log.user_id || '',
        escapeCSV(log.username),
        escapeCSV(log.user_name),
        escapeCSV(log.action),
        escapeCSV(log.details || ''),
        escapeCSV(log.ip_address || ''),
        escapeCSV(log.user_agent || ''),
        log.timestamp
      ].join(','));

      const csv = [headers.join(','), ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="activity-log.csv"');
      return res.send(csv);
    }

    // Default: JSON
    const data = {
      exportDate: new Date().toISOString(),
      totalLogs: logs.length,
      logs
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="activity-log.json"');
    res.json(data);
  } catch (error) {
    console.error('Error exporting activity logs:', error);
    res.status(500).json({ error: 'Failed to export activity logs' });
  }
});

/**
 * GET /api/logs/stats — Get log statistics (counts by action/user).
 */
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const total = await db.get('SELECT COUNT(*) as count FROM activity_log');

    const actionCounts = await db.all(
      `SELECT action, COUNT(*) as count FROM activity_log GROUP BY action ORDER BY count DESC`
    );

    const recentCount = await db.get(
      `SELECT COUNT(*) as count FROM activity_log WHERE timestamp >= datetime('now', '-24 hours')`
    );

    res.json({
      total: total ? total.count : 0,
      last24h: recentCount ? recentCount.count : 0,
      byAction: actionCounts
    });
  } catch (error) {
    console.error('Error fetching log stats:', error);
    res.status(500).json({ error: 'Failed to fetch log statistics' });
  }
});

/**
 * Escape CSV special characters
 */
function escapeCSV(text) {
  if (typeof text !== 'string') {
    text = String(text);
  }
  return `"${text.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, ' ')}"`;
}

module.exports = router;
