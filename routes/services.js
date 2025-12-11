const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

// Get db from global scope
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

// Initialize database table for services
const initializeServicesTable = () => {
  const db = getDb();
  if (!db) return;

  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      custom_icon_path TEXT,
      status TEXT DEFAULT 'online',
      access_level TEXT DEFAULT 'public',
      template_key TEXT,
      health_check_enabled BOOLEAN DEFAULT 1,
      health_check_interval INTEGER DEFAULT 60,
      health_check_timeout INTEGER DEFAULT 5000,
      expected_status_codes TEXT DEFAULT '[200, 301, 302]',
      last_health_check DATETIME,
      last_health_check_result TEXT,
      uptime_total_checks INTEGER DEFAULT 0,
      uptime_successful_checks INTEGER DEFAULT 0,
      uptime_percentage REAL DEFAULT 100,
      average_response_time REAL DEFAULT 0,
      last_downtime DATETIME,
      downtime_duration INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error('Error creating services table:', err);
    } else {
      console.log('Services table initialized successfully');
    }
  });
};

// Call initialization on startup
initializeServicesTable();

// Service templates database
const SERVICE_TEMPLATES = {
  nextcloud: {
    name: 'Nextcloud',
    icon: 'fas fa-cloud',
    description: 'File sharing and collaboration platform with sync, calendar, and contacts'
  },
  synology: {
    name: 'Synology NAS',
    icon: 'fas fa-network-wired',
    description: 'Network attached storage with backup, media, and application features'
  },
  truenas: {
    name: 'TrueNAS',
    icon: 'fas fa-database',
    description: 'Open source network-attached storage and hyperconverged infrastructure'
  },
  seafile: {
    name: 'Seafile',
    icon: 'fas fa-share-alt',
    description: 'Self-hosted cloud storage and collaboration platform'
  },
  plex: {
    name: 'Plex Media Server',
    icon: 'fas fa-play-circle',
    description: 'Media streaming service for movies, TV shows, and music'
  },
  jellyfin: {
    name: 'Jellyfin',
    icon: 'fas fa-film',
    description: 'Free open source media streaming platform'
  },
  emby: {
    name: 'Emby',
    icon: 'fas fa-video',
    description: 'Powerful media server with streaming capabilities'
  },
  kaleidescape: {
    name: 'Kaleidescape',
    icon: 'fas fa-cube',
    description: 'Premium movie server and streaming solution'
  },
  gitlab: {
    name: 'GitLab',
    icon: 'fab fa-gitlab',
    description: 'Git repository management with CI/CD pipelines'
  },
  gitea: {
    name: 'Gitea',
    icon: 'fas fa-code-branch',
    description: 'Lightweight self-hosted Git repository management'
  },
  'github-enterprise': {
    name: 'GitHub Enterprise',
    icon: 'fab fa-github',
    description: 'Enterprise GitHub instance for private repositories'
  },
  jenkins: {
    name: 'Jenkins',
    icon: 'fas fa-cogs',
    description: 'Automation server for building and testing code'
  },
  mattermost: {
    name: 'Mattermost',
    icon: 'fas fa-comments',
    description: 'Self-hosted team communication and collaboration'
  },
  jitsi: {
    name: 'Jitsi Meet',
    icon: 'fas fa-video',
    description: 'Open source video conference platform'
  },
  rocketchat: {
    name: 'Rocket.Chat',
    icon: 'fas fa-rocket',
    description: 'Self-hosted team chat and collaboration platform'
  },
  matrix: {
    name: 'Matrix/Synapse',
    icon: 'fas fa-comments',
    description: 'Decentralized communication protocol and homeserver'
  },
  portainer: {
    name: 'Portainer',
    icon: 'fas fa-docker',
    description: 'Docker and Kubernetes container management platform'
  },
  unraid: {
    name: 'Unraid',
    icon: 'fas fa-server',
    description: 'NAS and virtualization operating system'
  },
  proxmox: {
    name: 'Proxmox VE',
    icon: 'fas fa-tv',
    description: 'Open source virtualization management platform'
  },
  esxi: {
    name: 'VMware ESXi',
    icon: 'fas fa-microchip',
    description: 'VMware hypervisor for virtual machines'
  },
  pfsense: {
    name: 'pfSense',
    icon: 'fas fa-shield-alt',
    description: 'Open source firewall and routing platform'
  },
  opnsense: {
    name: 'OPNsense',
    icon: 'fas fa-lock',
    description: 'Open source firewall and routing platform'
  },
  vaultwarden: {
    name: 'Vaultwarden',
    icon: 'fas fa-lock',
    description: 'Self-hosted password manager and vault'
  },
  keycloak: {
    name: 'Keycloak',
    icon: 'fas fa-key',
    description: 'Open source identity and access management'
  },
  authentik: {
    name: 'Authentik',
    icon: 'fas fa-shield-alt',
    description: 'Authentication and authorization platform'
  },
  qbittorrent: {
    name: 'qBittorrent',
    icon: 'fas fa-download',
    description: 'Lightweight BitTorrent client'
  },
  transmission: {
    name: 'Transmission',
    icon: 'fas fa-arrow-down',
    description: 'Open source BitTorrent client'
  },
  sonarr: {
    name: 'Sonarr',
    icon: 'fas fa-tv',
    description: 'TV show downloader and organizer'
  },
  radarr: {
    name: 'Radarr',
    icon: 'fas fa-film',
    description: 'Movie downloader and organizer'
  },
  lidarr: {
    name: 'Lidarr',
    icon: 'fas fa-music',
    description: 'Music downloader and organizer'
  },
  prowlarr: {
    name: 'Prowlarr',
    icon: 'fas fa-search',
    description: 'Indexer manager and proxy for *arr applications'
  },
  homeassistant: {
    name: 'Home Assistant',
    icon: 'fas fa-home',
    description: 'Open source home automation and IoT platform'
  },
  pihole: {
    name: 'Pi-hole',
    icon: 'fas fa-shield-alt',
    description: 'DNS sinkhole for ad-blocking and privacy'
  },
  adguard: {
    name: 'AdGuard Home',
    icon: 'fas fa-shield-alt',
    description: 'Network-wide ad and tracker blocker'
  },
  unmanic: {
    name: 'Unmanic',
    icon: 'fas fa-wand-magic-sparkles',
    description: 'Video transcoding automation'
  },
  openvpn: {
    name: 'OpenVPN',
    icon: 'fas fa-vpn-lock',
    description: 'Open source VPN solution'
  },
  wireguard: {
    name: 'WireGuard',
    icon: 'fas fa-vpn-lock',
    description: 'Modern VPN with improved security and performance'
  },
  wiki: {
    name: 'Wiki.js',
    icon: 'fas fa-book',
    description: 'Modern, lightweight wiki software'
  },
  confluence: {
    name: 'Confluence',
    icon: 'fas fa-file-alt',
    description: 'Team workspace and documentation platform'
  },
  mediawiki: {
    name: 'MediaWiki',
    icon: 'fas fa-database',
    description: 'Wiki engine that powers Wikipedia'
  }
};

// GET /api/services/templates - Get all available service templates (must come before /api/services/:id)
router.get('/templates', authenticateToken, (req, res) => {
  try {
    res.json({
      templates: SERVICE_TEMPLATES
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/services - Get all services for current user (admin)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    db.all(
      `SELECT * FROM services WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
      (err, services) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        // Parse JSON fields
        const parsed = (services || []).map(service => ({
          ...service,
          expected_status_codes: safeJsonParse(service.expected_status_codes, [200, 301, 302]),
          last_health_check_result: safeJsonParse(service.last_health_check_result, null)
        }));

        res.json(parsed);
      }
    );
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/services - Create a new service
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      url,
      description,
      icon,
      status = 'online',
      access_level = 'public',
      template_key = null,
      health_check_enabled = true,
      health_check_interval = 60,
      health_check_timeout = 5000,
      expected_status_codes = [200, 301, 302]
    } = req.body;

    // Validate required fields
    if (!name || !url) {
      return res.status(400).json({ error: 'Name and URL are required' });
    }

    const db = getDb();
    const userId = req.user.id;

    db.run(
      `INSERT INTO services (
        user_id, name, url, description, icon, status, access_level,
        template_key, health_check_enabled, health_check_interval,
        health_check_timeout, expected_status_codes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        name,
        url,
        description || null,
        icon || 'fas fa-cube',
        status,
        access_level,
        template_key,
        health_check_enabled ? 1 : 0,
        health_check_interval,
        health_check_timeout,
        JSON.stringify(expected_status_codes)
      ],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        res.status(201).json({
          id: this.lastID,
          user_id: userId,
          name,
          url,
          description,
          icon,
          status,
          access_level,
          template_key,
          health_check_enabled,
          health_check_interval,
          health_check_timeout,
          expected_status_codes
        });
      }
    );
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/services/:id - Update a service
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      url,
      description,
      icon,
      status,
      access_level,
      health_check_enabled,
      health_check_interval,
      health_check_timeout,
      expected_status_codes
    } = req.body;

    const db = getDb();
    const userId = req.user.id;

    // Verify ownership
    db.get(
      `SELECT id FROM services WHERE id = ? AND user_id = ?`,
      [id, userId],
      (err, service) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!service) {
          return res.status(404).json({ error: 'Service not found' });
        }

        // Update service
        db.run(
          `UPDATE services SET
            name = ?, url = ?, description = ?, icon = ?,
            status = ?, access_level = ?,
            health_check_enabled = ?, health_check_interval = ?,
            health_check_timeout = ?, expected_status_codes = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [
            name,
            url,
            description,
            icon,
            status,
            access_level,
            health_check_enabled ? 1 : 0,
            health_check_interval,
            health_check_timeout,
            JSON.stringify(expected_status_codes),
            id
          ],
          (err) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            res.json({
              id: parseInt(id),
              name,
              url,
              description,
              icon,
              status,
              access_level,
              health_check_enabled,
              health_check_interval,
              health_check_timeout,
              expected_status_codes
            });
          }
        );
      }
    );
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/services/:id - Delete a service
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const userId = req.user.id;

    // Verify ownership and get service
    db.get(
      `SELECT custom_icon_path FROM services WHERE id = ? AND user_id = ?`,
      [id, userId],
      (err, service) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!service) {
          return res.status(404).json({ error: 'Service not found' });
        }

        // Delete custom icon if it exists
        if (service.custom_icon_path) {
          const iconPath = path.join(__dirname, '..', service.custom_icon_path);
          fs.unlink(iconPath).catch(err => console.log('Could not delete icon file:', err));
        }

        // Delete service
        db.run(
          `DELETE FROM services WHERE id = ?`,
          [id],
          (err) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            res.json({ message: 'Service deleted successfully' });
          }
        );
      }
    );
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function for safe JSON parsing
function safeJsonParse(json, defaultValue) {
  try {
    return JSON.parse(json);
  } catch (e) {
    return defaultValue;
  }
}

module.exports = router;
module.exports.initializeServicesTable = initializeServicesTable;
module.exports.SERVICE_TEMPLATES = SERVICE_TEMPLATES;
