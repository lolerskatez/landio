const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');

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

// Service templates database with enhanced metadata
const SERVICE_TEMPLATES = {
  nextcloud: {
    name: 'Nextcloud',
    icon: 'fas fa-cloud',
    iconColor: '#0082C9',
    description: 'File sharing and collaboration platform with sync, calendar, and contacts',
    defaultPorts: [80, 443],
    probeUrls: ['/status.php', '/index.php/login']
  },
  synology: {
    name: 'Synology NAS',
    icon: 'fas fa-network-wired',
    iconColor: '#FF8C00',
    description: 'Network attached storage with backup, media, and application features',
    defaultPorts: [5000, 5001],
    probeUrls: ['/webman/login.cgi', '/webman/index.cgi']
  },
  truenas: {
    name: 'TrueNAS',
    icon: 'fas fa-database',
    iconColor: '#0095D5',
    description: 'Open source network-attached storage and hyperconverged infrastructure',
    defaultPorts: [80, 443],
    probeUrls: ['/ui/', '/api/v2.0/']
  },
  seafile: {
    name: 'Seafile',
    icon: 'fas fa-share-alt',
    iconColor: '#0093DD',
    description: 'Self-hosted cloud storage and collaboration platform',
    defaultPorts: [8000, 8082],
    probeUrls: ['/accounts/login/', '/api2/ping/']
  },
  plex: {
    name: 'Plex Media Server',
    icon: 'fas fa-play-circle',
    iconColor: '#E5A00D',
    description: 'Media streaming service for movies, TV shows, and music',
    defaultPorts: [32400],
    probeUrls: ['/web/index.html', '/identity']
  },
  jellyfin: {
    name: 'Jellyfin',
    icon: 'fas fa-film',
    iconColor: '#00A4DC',
    description: 'Free open source media streaming platform',
    defaultPorts: [8096, 8920],
    probeUrls: ['/web/index.html', '/System/Info/Public']
  },
  emby: {
    name: 'Emby',
    icon: 'fas fa-video',
    iconColor: '#52B54B',
    description: 'Powerful media server with streaming capabilities',
    defaultPorts: [8096, 8920],
    probeUrls: ['/web/index.html', '/emby/System/Info/Public']
  },
  kaleidescape: {
    name: 'Kaleidescape',
    icon: 'fas fa-cube',
    iconColor: '#1C3F94',
    description: 'Premium movie server and streaming solution',
    defaultPorts: [443],
    probeUrls: ['/']
  },
  gitlab: {
    name: 'GitLab',
    icon: 'fab fa-gitlab',
    iconColor: '#FC6D26',
    description: 'Git repository management with CI/CD pipelines',
    defaultPorts: [80, 443],
    probeUrls: ['/users/sign_in', '/api/v4/version']
  },
  gitea: {
    name: 'Gitea',
    icon: 'fas fa-code-branch',
    iconColor: '#609926',
    description: 'Lightweight self-hosted Git repository management',
    defaultPorts: [3000],
    probeUrls: ['/user/login', '/api/v1/version']
  },
  'github-enterprise': {
    name: 'GitHub Enterprise',
    icon: 'fab fa-github',
    iconColor: '#24292E',
    description: 'Enterprise GitHub instance for private repositories',
    defaultPorts: [80, 443],
    probeUrls: ['/login', '/api/v3']
  },
  jenkins: {
    name: 'Jenkins',
    icon: 'fas fa-cogs',
    iconColor: '#D24939',
    description: 'Automation server for building and testing code',
    defaultPorts: [8080],
    probeUrls: ['/login', '/api/json']
  },
  mattermost: {
    name: 'Mattermost',
    icon: 'fas fa-comments',
    iconColor: '#0072C6',
    description: 'Self-hosted team communication and collaboration',
    defaultPorts: [8065],
    probeUrls: ['/login', '/api/v4/system/ping']
  },
  jitsi: {
    name: 'Jitsi Meet',
    icon: 'fas fa-video',
    iconColor: '#1D76BA',
    description: 'Open source video conference platform',
    defaultPorts: [443],
    probeUrls: ['/', '/config.js']
  },
  rocketchat: {
    name: 'Rocket.Chat',
    icon: 'fas fa-rocket',
    iconColor: '#F5455C',
    description: 'Self-hosted team chat and collaboration platform',
    defaultPorts: [3000],
    probeUrls: ['/home', '/api/info']
  },
  matrix: {
    name: 'Matrix/Synapse',
    icon: 'fas fa-comments',
    iconColor: '#000000',
    description: 'Decentralized communication protocol and homeserver',
    defaultPorts: [8008, 8448],
    probeUrls: ['/_matrix/client/versions', '/_synapse/admin/v1/server_version']
  },
  portainer: {
    name: 'Portainer',
    icon: 'fas fa-docker',
    iconColor: '#13BEF9',
    description: 'Docker and Kubernetes container management platform',
    defaultPorts: [9000, 9443],
    probeUrls: ['/api/status', '/']
  },
  unraid: {
    name: 'Unraid',
    icon: 'fas fa-server',
    iconColor: '#F15A2C',
    description: 'NAS and virtualization operating system',
    defaultPorts: [80, 443],
    probeUrls: ['/Main', '/']
  },
  proxmox: {
    name: 'Proxmox VE',
    icon: 'fas fa-tv',
    iconColor: '#E57000',
    description: 'Open source virtualization management platform',
    defaultPorts: [8006],
    probeUrls: ['/api2/json/version', '/#v1:0:18:4::::::']
  },
  esxi: {
    name: 'VMware ESXi',
    icon: 'fas fa-microchip',
    iconColor: '#607078',
    description: 'VMware hypervisor for virtual machines',
    defaultPorts: [443],
    probeUrls: ['/ui/', '/sdk']
  },
  pfsense: {
    name: 'pfSense',
    icon: 'fas fa-shield-alt',
    iconColor: '#212D3B',
    description: 'Open source firewall and routing platform',
    defaultPorts: [80, 443],
    probeUrls: ['/index.php', '/']
  },
  opnsense: {
    name: 'OPNsense',
    icon: 'fas fa-lock',
    iconColor: '#D94F00',
    description: 'Open source firewall and routing platform',
    defaultPorts: [80, 443],
    probeUrls: ['/ui/core/login', '/']
  },
  vaultwarden: {
    name: 'Vaultwarden',
    icon: 'fas fa-lock',
    iconColor: '#175DDC',
    description: 'Self-hosted password manager and vault',
    defaultPorts: [80, 443],
    probeUrls: ['/', '/api/config']
  },
  keycloak: {
    name: 'Keycloak',
    icon: 'fas fa-key',
    iconColor: '#4D4D4D',
    description: 'Open source identity and access management',
    defaultPorts: [8080, 8443],
    probeUrls: ['/auth/', '/realms/master']
  },
  authentik: {
    name: 'Authentik',
    icon: 'fas fa-shield-alt',
    iconColor: '#FD4B2D',
    description: 'Authentication and authorization platform',
    defaultPorts: [9000, 9443],
    probeUrls: ['/if/flow/initial-setup/', '/api/v3/']
  },
  qbittorrent: {
    name: 'qBittorrent',
    icon: 'fas fa-download',
    iconColor: '#3E7FC1',
    description: 'Lightweight BitTorrent client',
    defaultPorts: [8080],
    probeUrls: ['/api/v2/app/version', '/']
  },
  transmission: {
    name: 'Transmission',
    icon: 'fas fa-arrow-down',
    iconColor: '#C41E3A',
    description: 'Open source BitTorrent client',
    defaultPorts: [9091],
    probeUrls: ['/transmission/web/', '/transmission/rpc']
  },
  sonarr: {
    name: 'Sonarr',
    icon: 'fas fa-tv',
    iconColor: '#35C5F4',
    description: 'TV show downloader and organizer',
    defaultPorts: [8989],
    probeUrls: ['/api/v3/system/status', '/']
  },
  radarr: {
    name: 'Radarr',
    icon: 'fas fa-film',
    iconColor: '#FFC230',
    description: 'Movie downloader and organizer',
    defaultPorts: [7878],
    probeUrls: ['/api/v3/system/status', '/']
  },
  lidarr: {
    name: 'Lidarr',
    icon: 'fas fa-music',
    iconColor: '#159552',
    description: 'Music downloader and organizer',
    defaultPorts: [8686],
    probeUrls: ['/api/v1/system/status', '/']
  },
  prowlarr: {
    name: 'Prowlarr',
    icon: 'fas fa-search',
    iconColor: '#4ECDC4',
    description: 'Indexer manager and proxy for *arr applications',
    defaultPorts: [9696],
    probeUrls: ['/api/v1/system/status', '/']
  },
  homeassistant: {
    name: 'Home Assistant',
    icon: 'fas fa-home',
    iconColor: '#41BDF5',
    description: 'Open source home automation and IoT platform',
    defaultPorts: [8123],
    probeUrls: ['/api/', '/manifest.json']
  },
  pihole: {
    name: 'Pi-hole',
    icon: 'fas fa-shield-alt',
    iconColor: '#96060C',
    description: 'DNS sinkhole for ad-blocking and privacy',
    defaultPorts: [80],
    probeUrls: ['/admin/', '/admin/api.php']
  },
  adguard: {
    name: 'AdGuard Home',
    icon: 'fas fa-shield-alt',
    iconColor: '#68BC71',
    description: 'Network-wide ad and tracker blocker',
    defaultPorts: [3000, 80],
    probeUrls: ['/login.html', '/control/status']
  },
  unmanic: {
    name: 'Unmanic',
    icon: 'fas fa-wand-magic-sparkles',
    iconColor: '#FF6600',
    description: 'Video transcoding automation',
    defaultPorts: [8888],
    probeUrls: ['/', '/api/v2/settings']
  },
  openvpn: {
    name: 'OpenVPN',
    icon: 'fas fa-lock',
    iconColor: '#EA7E20',
    description: 'Open source VPN solution',
    defaultPorts: [943, 443],
    probeUrls: ['/', '/']
  },
  wireguard: {
    name: 'WireGuard',
    icon: 'fas fa-lock',
    iconColor: '#88171A',
    description: 'Modern VPN with improved security and performance',
    defaultPorts: [51820],
    probeUrls: ['/']
  },
  wiki: {
    name: 'Wiki.js',
    icon: 'fas fa-book',
    iconColor: '#1976D2',
    description: 'Modern, lightweight wiki software',
    defaultPorts: [3000],
    probeUrls: ['/', '/login']
  },
  confluence: {
    name: 'Confluence',
    icon: 'fas fa-file-alt',
    iconColor: '#205081',
    description: 'Team workspace and documentation platform',
    defaultPorts: [8090],
    probeUrls: ['/login.action', '/']
  },
  mediawiki: {
    name: 'MediaWiki',
    icon: 'fas fa-database',
    iconColor: '#006699',
    description: 'Wiki engine that powers Wikipedia',
    defaultPorts: [80, 443],
    probeUrls: ['/api.php', '/index.php/Main_Page']
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

// POST /api/services/autodiscover - Attempt to auto-discover service details from URL
router.post('/autodiscover', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { baseUrl, templateKey } = req.body;
    
    if (!baseUrl) {
      return res.status(400).json({ error: 'Base URL is required' });
    }

    // Normalize URL - add protocol if missing
    let normalizedUrl = baseUrl.trim();
    if (!normalizedUrl.match(/^https?:\/\//)) {
      normalizedUrl = 'http://' + normalizedUrl;
    }

    // Parse URL
    let parsedUrl;
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format. Please use format: http://example.com or example.com' });
    }

    const results = {
      url: normalizedUrl,
      discovered: false,
      suggestions: [],
      template: null
    };

    // If template key provided, use its metadata
    if (templateKey && SERVICE_TEMPLATES[templateKey]) {
      const template = SERVICE_TEMPLATES[templateKey];
      results.template = templateKey;
      
      // Try to probe the service at the given URL
      const probePaths = template.probeUrls || ['/'];

      for (const probePath of probePaths.slice(0, 3)) { // Limit to 3 probe attempts
        try {
          const probeUrl = new URL(probePath, normalizedUrl).toString();
          const probeResult = await checkUrlReachable(probeUrl, 3000);
          
          if (probeResult.success) {
            results.discovered = true;
            results.suggestions.push({
              url: normalizedUrl,
              statusCode: probeResult.statusCode,
              responseTime: probeResult.responseTime,
              confidence: 'high',
              probeUrl: probeUrl
            });
            break;
          }
        } catch (e) {
          // Continue to next probe
          console.log('Probe failed for', probePath, ':', e.message);
        }
      }

      // Suggest alternative ports if discovery failed
      if (!results.discovered && template.defaultPorts) {
        for (const port of template.defaultPorts) {
          const protocol = port === 443 || port >= 8443 ? 'https' : 'http';
          const suggestedUrl = `${protocol}://${parsedUrl.hostname}:${port}`;
          results.suggestions.push({
            url: suggestedUrl,
            port: port,
            confidence: 'medium',
            reason: `Default ${template.name} port`
          });
        }
      }
    } else {
      // No template - just try to reach the URL
      try {
        const probeResult = await checkUrlReachable(normalizedUrl, 5000);
        if (probeResult.success) {
          results.discovered = true;
          results.suggestions.push({
            url: normalizedUrl,
            statusCode: probeResult.statusCode,
            responseTime: probeResult.responseTime,
            confidence: 'medium'
          });
        } else {
          results.suggestions.push({
            url: normalizedUrl,
            confidence: 'low',
            statusCode: probeResult.statusCode,
            error: `Service returned HTTP ${probeResult.statusCode}`
          });
        }
      } catch (e) {
        results.suggestions.push({
          url: normalizedUrl,
          confidence: 'low',
          error: e.message || 'Could not reach service'
        });
      }
    }

    res.json(results);
  } catch (err) {
    console.error('Error in autodiscover:', err);
    res.status(500).json({ error: 'Autodiscovery failed', details: err.message });
  }
});

// Helper function to check if a URL is reachable
function checkUrlReachable(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const startTime = Date.now();
      const request = protocol.get(url, {
        timeout: timeout,
        rejectUnauthorized: false, // Allow self-signed certificates
        headers: {
          'User-Agent': 'Landio-Service-Discovery/1.0'
        }
      }, (res) => {
        const responseTime = Date.now() - startTime;
        
        // Consume response to free up memory
        res.resume();
        
        resolve({
          success: res.statusCode < 500,
          statusCode: res.statusCode,
          responseTime: responseTime
        });
      });

      request.on('error', (err) => {
        reject(new Error(err.message || 'Request failed'));
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    } catch (err) {
      reject(new Error(err.message || 'URL parsing error'));
    }
  });
}

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
