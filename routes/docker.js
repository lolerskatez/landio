const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin, requireAdminOrPowerUser } = require('../middleware/auth');
const {
  listContainers,
  inspectContainer,
  startContainer,
  stopContainer,
  restartContainer,
  pauseContainer,
  unpauseContainer,
  getContainerLogs,
  getContainerStats,
  execInContainer,
  getDockerInfo,
  testDockerConnection,
  createDockerClient,
} = require('../lib/docker');

// Helper to get db
const getDb = () => global.db;

/**
 * Middleware to check Docker permissions.
 * Admins have full control, PowerUsers have view + start/stop (no inspect sensitive, no exec).
 */
const checkDockerPermission = (req, res, next) => {
  if (req.user.role === 'admin') {
    req.dockerPermission = 'full';
    return next();
  }
  if (req.user.role === 'poweruser') {
    req.dockerPermission = 'limited';
    return next();
  }
  return res.status(403).json({ error: 'Insufficient permissions for Docker management' });
};

/**
 * Middleware to load Docker connection settings from DB.
 */
const loadDockerSettings = async (req, res, next) => {
  try {
    const db = getDb();
    const settings = await new Promise((resolve, reject) => {
      db.all(
        'SELECT key, value FROM settings WHERE user_id IS NULL AND key LIKE ?',
        ['docker-%'],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    const dockerSettings = {};
    settings.forEach(s => { dockerSettings[s.key] = s.value; });

    // Build connection config
    const connectionConfig = {};

    if (dockerSettings['docker-connection-type'] === 'tcp') {
      connectionConfig.tcpHost = dockerSettings['docker-tcp-host'] || '';
      connectionConfig.tcpPort = parseInt(dockerSettings['docker-tcp-port']) || 2375;
      connectionConfig.tlsEnabled = dockerSettings['docker-tls-enabled'] === 'true';
    } else if (dockerSettings['docker-connection-type'] === 'socket') {
      connectionConfig.socketPath = dockerSettings['docker-socket-path'] || '/var/run/docker.sock';
    }

    // If auto-detect is enabled, ignore settings and use defaults
    if (dockerSettings['docker-auto-detect'] !== 'false') {
      req.dockerSettings = {}; // Use auto-detect defaults
    } else {
      req.dockerSettings = connectionConfig;
    }

    next();
  } catch (err) {
    console.error('Error loading Docker settings:', err);
    next();
  }
};

// ─── Docker Status & Info ─────────────────────────────────────────────────────

// GET /api/docker/status - Check if Docker is available
router.get('/status', authenticateToken, requireAdminOrPowerUser, async (req, res) => {
  try {
    const result = await testDockerConnection();
    res.json({
      available: result.connected,
      version: result.version,
      error: result.error,
    });
  } catch (error) {
    res.json({ available: false, error: error.message });
  }
});

// GET /api/docker/info - Docker system info (admin only for full info)
router.get('/info', authenticateToken, loadDockerSettings, checkDockerPermission, async (req, res) => {
  try {
    const info = await getDockerInfo();
    if (req.dockerPermission === 'limited') {
      // Power users: limited info
      const { id, name, serverVersion, os, kernel, architecture, containers, running, paused, stopped, images, driver, cpuCount, totalMemory, totalMemoryHuman } = info;
      return res.json({
        id, name, serverVersion, os, kernel, architecture,
        containers, running, paused, stopped, images, driver,
        cpuCount, totalMemory, totalMemoryHuman
      });
    }
    res.json(info);
  } catch (error) {
    res.status(503).json({ error: 'Docker not available', message: error.message });
  }
});

// ─── Container Operations ─────────────────────────────────────────────────────

// GET /api/docker/containers - List all containers
router.get('/containers', authenticateToken, loadDockerSettings, requireAdminOrPowerUser, async (req, res) => {
  try {
    const containers = await listContainers({ all: true });
    res.json({ containers, count: containers.length });
  } catch (error) {
    res.status(503).json({ error: 'Failed to list containers', message: error.message });
  }
});

// GET /api/docker/containers/:id - Inspect container (admin only for full detail)
router.get('/containers/:id', authenticateToken, loadDockerSettings, checkDockerPermission, async (req, res) => {
  try {
    const info = await inspectContainer(req.params.id);
    if (req.dockerPermission === 'limited') {
      // Power users: limited detail (no sensitive env vars, no host config)
      const { id, shortId, name, image, state, config, networkSettings, created, mounts } = info;
      return res.json({
        id, shortId, name, image, state,
        config: {
          hostname: config.hostname,
          exposedPorts: config.exposedPorts,
          cmd: config.cmd,
          entrypoint: config.entrypoint,
          labels: config.labels,
          workingDir: config.workingDir,
        },
        networkSettings,
        created,
        mounts,
      });
    }
    res.json(info);
  } catch (error) {
    res.status(404).json({ error: 'Container not found', message: error.message });
  }
});

// POST /api/docker/containers/:id/start - Start container
router.post('/containers/:id/start', authenticateToken, loadDockerSettings, requireAdminOrPowerUser, async (req, res) => {
  try {
    const result = await startContainer(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to start container', message: error.message });
  }
});

// POST /api/docker/containers/:id/stop - Stop container
router.post('/containers/:id/stop', authenticateToken, loadDockerSettings, requireAdminOrPowerUser, async (req, res) => {
  try {
    const timeout = req.body.timeout || 10;
    const result = await stopContainer(req.params.id, timeout);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop container', message: error.message });
  }
});

// POST /api/docker/containers/:id/restart - Restart container
router.post('/containers/:id/restart', authenticateToken, loadDockerSettings, requireAdminOrPowerUser, async (req, res) => {
  try {
    const timeout = req.body.timeout || 10;
    const result = await restartContainer(req.params.id, timeout);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart container', message: error.message });
  }
});

// POST /api/docker/containers/:id/pause - Pause container
router.post('/containers/:id/pause', authenticateToken, loadDockerSettings, requireAdminOrPowerUser, async (req, res) => {
  try {
    const result = await pauseContainer(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to pause container', message: error.message });
  }
});

// POST /api/docker/containers/:id/unpause - Unpause container
router.post('/containers/:id/unpause', authenticateToken, loadDockerSettings, requireAdminOrPowerUser, async (req, res) => {
  try {
    const result = await unpauseContainer(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to unpause container', message: error.message });
  }
});

// GET /api/docker/containers/:id/logs - Get container logs
router.get('/containers/:id/logs', authenticateToken, loadDockerSettings, requireAdminOrPowerUser, async (req, res) => {
  try {
    const tail = parseInt(req.query.tail) || 100;
    const timestamps = req.query.timestamps === 'true';
    const logs = await getContainerLogs(req.params.id, { tail, timestamps });
    res.json({ containerId: req.params.id, logs, lines: logs.split('\n').length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get container logs', message: error.message });
  }
});

// GET /api/docker/containers/:id/stats - Get container stats
router.get('/containers/:id/stats', authenticateToken, loadDockerSettings, requireAdminOrPowerUser, async (req, res) => {
  try {
    const stats = await getContainerStats(req.params.id);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get container stats', message: error.message });
  }
});

// POST /api/docker/containers/:id/exec - Execute command in container (admin only)
router.post('/containers/:id/exec', authenticateToken, loadDockerSettings, requireAdmin, async (req, res) => {
  try {
    const { cmd, tty } = req.body;
    if (!cmd) {
      return res.status(400).json({ error: 'Command is required' });
    }
    const result = await execInContainer(req.params.id, { cmd, tty: tty || false });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to execute command', message: error.message });
  }
});

// ─── Connection Test ──────────────────────────────────────────────────────────

// POST /api/docker/test - Test Docker connection (admin only)
router.post('/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { connectionType, socketPath, tcpHost, tcpPort, tlsEnabled } = req.body;

    const settings = {};
    if (connectionType === 'tcp') {
      settings.tcpHost = tcpHost;
      settings.tcpPort = parseInt(tcpPort) || 2375;
      settings.tlsEnabled = tlsEnabled === true;
    } else {
      settings.socketPath = socketPath || '/var/run/docker.sock';
    }

    const result = await testDockerConnection(settings);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Connection test failed', message: error.message });
  }
});

module.exports = router;
