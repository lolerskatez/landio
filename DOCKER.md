# Docker Setup Guide for Landio

## 🚀 Automated Deployment (Recommended)

For Ubuntu servers, use the automated deployment script:

```bash
# Download and run the deployment script
curl -fsSL https://raw.githubusercontent.com/lolerskatez/landio/master/deploy.sh -o deploy.sh
chmod +x deploy.sh
./deploy.sh
```

The script will:
- ✅ Check that Docker and Docker Compose are installed and running
- ✅ Clone the Landio repository
- ✅ Generate secure JWT and session secrets
- ✅ Configure environment variables
- ✅ Start Docker services
- ✅ Verify deployment success
- ✅ Provide access URLs and next steps

**That's it!** Your Landio instance will be running at `http://your-server:3001`

---

## Manual Setup

## Prerequisites

**Required:**
- Docker (20.10+)
- Docker Compose (1.29+ or plugin)
- Git (for cloning repository)

**Note:** The deployment script assumes Docker is already installed. If Docker is not installed, the script will provide installation instructions and exit.

### Using Docker Compose (Recommended)

#### 1. Clone and setup
```bash
git clone https://github.com/lolerskatez/landio.git
cd landio
```

#### 2. Create .env file
```bash
cp .env.example .env
```

Edit `.env` and update the secrets:
```env
JWT_SECRET=your-strong-random-secret-here
SESSION_SECRET=your-strong-random-secret-here
NODE_ENV=production
```

#### 3. Build and run
```bash
docker-compose up -d
```

The application will be available at `http://localhost:3001`

#### 4. Initialize database
On first run, the database is automatically initialized by the application.

```bash
# View logs
docker-compose logs -f landio

# Stop the application
docker-compose down

# Stop and remove data volume (WARNING: deletes database)
docker-compose down -v
```

---

## Docker Build Details

### Multi-stage Build
The Dockerfile uses a multi-stage build to minimize the final image size:
1. **Builder stage**: Installs dependencies
2. **Final stage**: Copies only production dependencies and application files

### Environment Variables
```
NODE_ENV=production       # Enable production mode
JWT_SECRET=xxx           # JWT signing secret (MUST change in production)
SESSION_SECRET=yyy       # Session secret (MUST change in production)
PORT=3001                # Application port
```

### Volumes
- `landio_data:/app/data` - SQLite database persistence
  - Mounted at `/app/data` in container
  - Database file: `/app/data/database.db`

### Health Check
- Endpoint: `http://localhost:3001`
- Interval: 30 seconds
- Timeout: 3 seconds
- Retries: 3

---

## Production Deployment

### 1. Generate Secure Secrets
```bash
# Generate JWT_SECRET
openssl rand -base64 32

# Generate SESSION_SECRET
openssl rand -base64 32
```

### 2. Update .env
```env
NODE_ENV=production
JWT_SECRET=<generated-secret>
SESSION_SECRET=<generated-secret>
```

### 3. Configure for HTTPS
If using Traefik or another reverse proxy:

Uncomment in `docker-compose.yml`:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.landio.rule=Host(`your-domain.com`)"
```

Or use nginx reverse proxy in front of Docker container.

### 4. Database Backup
Backup the database volume:
```bash
# Copy database from running container
docker-compose exec landio cp /app/data/database.db /app/data/database.backup.db

# Or backup the volume directly
docker run --rm -v landio_data:/data -v $(pwd):/backup alpine tar czf /backup/landio-backup.tar.gz -C /data .
```

### 5. Restore Database
```bash
docker run --rm -v landio_data:/data -v $(pwd):/backup alpine tar xzf /backup/landio-backup.tar.gz -C /data
```

---

## Docker Commands Reference

### View logs
```bash
docker-compose logs -f landio
```

### Execute command in container
```bash
docker-compose exec landio npm run init-db
```

### Restart service
```bash
docker-compose restart landio
```

### Rebuild image
```bash
docker-compose build --no-cache
```

### Remove all (WARNING: deletes database)
```bash
docker-compose down -v
```

### View container stats
```bash
docker stats landio
```

---

## Troubleshooting

### Port 3001 already in use
Change the port in `docker-compose.yml`:
```yaml
ports:
  - "8080:3001"  # Host:Container
```

### Database not initializing
```bash
# Check logs
docker-compose logs landio

# Manually initialize
docker-compose exec landio npm run init-db
```

### SSL/HTTPS not working
- Configure reverse proxy (nginx, Traefik, Caddy)
- Do NOT enable SSL directly in Node.js
- Use proxy headers: X-Forwarded-For, X-Forwarded-Proto

### Container exits immediately
```bash
# View error logs
docker-compose logs landio

# Run in interactive mode
docker-compose run --rm landio npm start
```

### Lost database after restart
Ensure volume is properly mounted:
```bash
# Verify volume exists
docker volume ls

# Verify it's in compose file
docker-compose config | grep -A 5 volumes
```

---

## Advanced Configuration

### Using External Database
For PostgreSQL or MySQL, modify `docker-compose.yml`:
```yaml
environment:
  - DATABASE_URL=postgresql://user:pass@db:5432/landio
services:
  db:
    image: postgres:15-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
```

### Custom Network
Already configured with `landio_network` bridge for easy connectivity.

### Resource Limits
Add to `docker-compose.yml`:
```yaml
services:
  landio:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### Environment File
Use multiple `.env` files:
```bash
# Development
docker-compose --file docker-compose.yml --env-file .env.dev up

# Production
docker-compose --file docker-compose.yml --env-file .env.prod up
```

---

## Next Steps

1. **Initial Setup**: Navigate to `http://localhost:3001/setup.html` to create admin account
2. **Enable 2FA**: Configure 2FA in settings
3. **Configure SSO** (Optional): Add Authentik or other OIDC provider
4. **Add Services**: Start adding services to monitor

For more details, see [ARCHITECTURE.md](ARCHITECTURE.md) and [DEPLOYMENT.md](DEPLOYMENT.md)
