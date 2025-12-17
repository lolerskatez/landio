# LandIO Deployment Guide

Complete guide for deploying LandIO to production environments.

## Table of Contents
- [Local Development](#local-development)
- [Docker Deployment](#docker-deployment)
- [Linux Server Deployment](#linux-server-deployment)
- [Windows Server Deployment](#windows-server-deployment)
- [Cloud Platform Deployment](#cloud-platform-deployment)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [Database Backup & Recovery](#database-backup--recovery)
- [Monitoring & Maintenance](#monitoring--maintenance)

## Local Development

### Quick Start
```bash
# Clone repository
git clone https://github.com/yourusername/landio.git
cd landio

# Install dependencies
npm install

# Initialize database
npm run init-db

# Start development server
npm run dev
```

Server runs on:
- **HTTPS**: `https://localhost:3443` (recommended)
- **HTTP**: `http://localhost:3001` (redirects to HTTPS)

**Note**: Self-signed certificates are auto-generated on first run. Accept the browser warning to proceed.

## Docker Deployment

### Create Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY . .

# Create database directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 3001

# Initialize database on startup
RUN npm run init-db

# Start application
CMD ["npm", "start"]
```

### Create docker-compose.yml
```yaml
version: '3.8'

services:
  landio:
    build: .
    ports:
      - "3001:3001"  # HTTP (redirects to HTTPS)
      - "3443:3443"  # HTTPS (primary)
    environment:
      - NODE_ENV=production
      - JWT_SECRET=${JWT_SECRET}
      - SESSION_SECRET=${SESSION_SECRET}
      - SMTP_ENABLED=${SMTP_ENABLED}
      - SMTP_HOST=${SMTP_HOST}
      - SMTP_USER=${SMTP_USER}
      - DISCORD_ENABLED=${DISCORD_ENABLED}
      - DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
    volumes:
      - landio_data:/app/data
      - landio_certs:/app/certs  # Persist SSL certificates
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "-k", "https://localhost:3443/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  landio_data:
  landio_certs:
```

### Deploy with Docker
```bash
# Build image
docker build -t landio:latest .

# Run container
docker run -d \
  --name landio \
  -p 3001:3001 \
  -e JWT_SECRET="your-secret-key" \
  -e NODE_ENV=production \
  -v landio-data:/app/data \
  landio:latest

# Or use docker-compose
docker-compose up -d
```

## Linux Server Deployment

### Prerequisites
- Ubuntu 20.04 LTS or later
- Node.js 18+
- Nginx or Apache
- SSL certificate (Let's Encrypt recommended)

### Step 1: Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Nginx
sudo apt install -y nginx

# Install PM2 (process manager)
sudo npm install -g pm2
```

### Step 2: Deploy Application
```bash
# Create application directory
sudo mkdir -p /var/www/landio
cd /var/www/landio

# Clone repository
sudo git clone https://github.com/yourusername/landio.git .

# Install dependencies
sudo npm install --production

# Initialize database
sudo npm run init-db

# Create .env file
sudo cp .env.example .env
sudo nano .env  # Edit with your configuration
```

### Step 3: Configure PM2
```bash
# Start with PM2
sudo pm2 start server.js --name "landio"

# Configure PM2 startup
sudo pm2 startup
sudo pm2 save

# Check status
pm2 status
```

### Step 4: Configure Nginx
```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/landio
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Certificate (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    # Reverse proxy to Node.js
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static files caching
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/landio /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 5: Set Up SSL with Let's Encrypt
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --nginx -d your-domain.com

# Auto-renewal
sudo systemctl enable certbot.timer
```

### Step 6: Database Backup
```bash
# Create backup script at /usr/local/bin/backup-landio.sh
#!/bin/bash
BACKUP_DIR="/var/backups/landio"
mkdir -p $BACKUP_DIR
cp /var/www/landio/database.db "$BACKUP_DIR/database-$(date +%Y%m%d-%H%M%S).db"
# Keep only last 30 days
find $BACKUP_DIR -type f -mtime +30 -delete

# Make executable
chmod +x /usr/local/bin/backup-landio.sh

# Add to crontab
sudo crontab -e
# Add: 0 3 * * * /usr/local/bin/backup-landio.sh
```

## Windows Server Deployment

### Prerequisites
- Windows Server 2019 or later
- Node.js 18+
- IIS with URL Rewrite and Application Request Routing

### Step 1: Install Node.js
```powershell
# Download and install Node.js from nodejs.org
# Or use Chocolatey
choco install nodejs
```

### Step 2: Deploy Application
```powershell
# Create application directory
New-Item -ItemType Directory -Path "C:\inetpub\wwwroot\landio"

# Clone repository
cd C:\inetpub\wwwroot\landio
git clone https://github.com/yourusername/landio.git .

# Install dependencies
npm install --production

# Initialize database
npm run init-db

# Copy and edit .env
Copy-Item .env.example .env
notepad .env  # Edit configuration
```

### Step 3: Configure IIS
1. Open IIS Manager
2. Add new Application Pool:
   - Name: LandIO
   - .NET CLR version: No Managed Code
   - Managed Pipeline Mode: Integrated

3. Add new Website:
   - Name: LandIO
   - Physical Path: C:\inetpub\wwwroot\landio
   - Binding: https://your-domain.com

4. Create web.config:
```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <webSocket enabled="false" />
    <rewrite>
      <rules>
        <rule name="HTTP to HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="^OFF$" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}{REQUEST_URI}" redirectType="Permanent" />
        </rule>
        <rule name="ReverseProxy" stopProcessing="true">
          <match url="^(.*)$" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false" />
          <action type="Rewrite" url="http://localhost:3001/{R:1}" />
        </conditions>
      </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

### Step 4: Use PM2 or NSSM for Process Management
```powershell
# Install PM2
npm install -g pm2

# Start application
pm2 start server.js --name "landio"

# Save PM2 configuration
pm2 save

# Create Windows service with PM2
pm2 install pm2-windows-startup
pm2 start ecosystem.config.js
pm2 save
```

## Cloud Platform Deployment

### Heroku Deployment
```bash
# Install Heroku CLI
# Create Procfile
echo "web: npm start" > Procfile

# Initialize git if needed
git init
git add .
git commit -m "Deploy to Heroku"

# Deploy
heroku create landio-app
heroku config:set JWT_SECRET="your-secret-key"
heroku config:set NODE_ENV="production"
git push heroku main

# View logs
heroku logs --tail
```

### DigitalOcean App Platform
1. Connect GitHub repository
2. Set environment variables in App Platform console
3. Set build command: `npm install && npm run init-db`
4. Set run command: `npm start`
5. Configure health check endpoint: `/api/health`

### AWS EC2
```bash
# Launch Ubuntu 20.04 LTS instance
# SSH into instance
ssh -i your-key.pem ubuntu@your-instance-ip

# Follow Linux Server Deployment steps above
```

### Google Cloud Run
```bash
# Deploy containerized app
gcloud run deploy landio \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars JWT_SECRET="your-secret-key",NODE_ENV="production"
```

## Reverse Proxy Setup

Landio runs with built-in HTTPS support using self-signed certificates for local development. For production deployments with custom domains, use a reverse proxy to handle SSL termination.

### Nginx (Recommended for Production)

#### Option 1: Proxy to HTTPS (Port 3443)
```nginx
server {
    listen 80;
    server_name tanjiro.one;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tanjiro.one;

    # Let's Encrypt SSL certificates
    ssl_certificate /etc/letsencrypt/live/tanjiro.one/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tanjiro.one/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    # Reverse proxy to Landio HTTPS
    location / {
        proxy_pass https://127.0.0.1:3443;
        proxy_ssl_verify off;  # Accept self-signed cert from Landio
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$ {
        proxy_pass https://127.0.0.1:3443;
        proxy_ssl_verify off;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

#### Option 2: Proxy to HTTP (Port 3001)
```nginx
server {
    listen 80;
    server_name tanjiro.one;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tanjiro.one;

    # Let's Encrypt SSL certificates
    ssl_certificate /etc/letsencrypt/live/tanjiro.one/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tanjiro.one/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Reverse proxy to Landio HTTP (SSL termination at Nginx)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Caddy (Automatic HTTPS)
```caddyfile
tanjiro.one {
    reverse_proxy localhost:3001
    
    # Or proxy to HTTPS
    # reverse_proxy https://localhost:3443 {
    #     transport http {
    #         tls_insecure_skip_verify
    #     }
    # }
}
```

### Traefik (Docker)
```yaml
# docker-compose.yml with Traefik labels
services:
  landio:
    image: landio:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.landio.rule=Host(`tanjiro.one`)"
      - "traefik.http.routers.landio.entrypoints=websecure"
      - "traefik.http.routers.landio.tls.certresolver=letsencrypt"
      - "traefik.http.services.landio.loadbalancer.server.port=3001"
    networks:
      - traefik
```

### Apache
```apache
<VirtualHost *:80>
    ServerName tanjiro.one
    Redirect permanent / https://tanjiro.one/
</VirtualHost>

<VirtualHost *:443>
    ServerName tanjiro.one

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/tanjiro.one/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/tanjiro.one/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3001/
    ProxyPassReverse / http://127.0.0.1:3001/

    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"
</VirtualHost>
```

### CORS Configuration
Landio automatically allows requests from:
- `localhost` and `127.0.0.1` (any port)
- Local network IPs: `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`
- **Custom domains**: Any valid domain name (e.g., `tanjiro.one`)

No additional CORS configuration needed for reverse proxy deployments!

## Database Backup & Recovery

### Automated Backups
```bash
# Add to crontab for daily backups at 2 AM
0 2 * * * cp /var/www/landio/database.db /backups/landio/database-$(date +\%Y\%m\%d).db

# Keep only 30 days of backups
0 3 * * * find /backups/landio -mtime +30 -delete
```

### Manual Backup
```bash
cp database.db database-$(date +%Y%m%d-%H%M%S).db
```

### Database Recovery
```bash
# Stop the application
pm2 stop landio

# Restore from backup
cp database-backup.db database.db

# Start the application
pm2 start landio

# Verify
pm2 logs landio
```

## Monitoring & Maintenance

### Health Check Endpoint
Implement in your API:
```javascript
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});
```

### Monitoring Tools
- **PM2 Plus:** Real-time monitoring, log aggregation
- **New Relic:** Application performance monitoring
- **Datadog:** Infrastructure monitoring
- **ELK Stack:** Log aggregation and analysis

### Log Management
```bash
# Rotate logs to prevent disk space issues
npm install --save-dev winston winston-daily-rotate-file

# Configure in server.js for production logging
```

### Security Checklist
- [ ] Change all default credentials
- [ ] Enable 2FA for all admin accounts
- [ ] Configure firewall rules
- [ ] Set strong JWT_SECRET
- [ ] Enable HTTPS with valid SSL certificate
- [ ] Regular security updates (`npm audit fix`)
- [ ] Database backups enabled
- [ ] Monitor logs for suspicious activity
- [ ] Restrict IP access if possible
- [ ] Configure rate limiting

### Performance Optimization
- Use reverse proxy (Nginx) for static files
- Enable gzip compression
- Implement caching headers
- Monitor database query performance
- Use clustering for Node.js on multi-core systems

### Troubleshooting

**Application won't start:**
```bash
pm2 logs landio --lines 50
npm run init-db
```

**Database locked error:**
```bash
# Stop all processes accessing database
pm2 stop all
# Check for stale connections
lsof +D /var/www/landio
# Restart
pm2 start landio
```

**High memory usage:**
```bash
# Check process memory
pm2 monit

# Increase heap size
pm2 start server.js --max-memory-restart 1G
```

**SSL certificate expiration:**
```bash
# Certbot auto-renewal should handle this
sudo certbot renew --dry-run
sudo certbot renew
```

## Support

For deployment issues, check:
- Application logs: `pm2 logs landio`
- System logs: `/var/log/syslog`
- Nginx logs: `/var/log/nginx/error.log`
- GitHub Issues: https://github.com/yourusername/landio/issues
