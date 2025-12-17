# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2024-12-17

### Added
- **HTTPS Support**: Automatic self-signed SSL certificate generation for local deployments
  - Self-signed certificates auto-generated on first run
  - Stored in `/certs` directory (persisted via Docker volume)
  - HTTP (port 3001) automatically redirects to HTTPS (port 3443)
  - Works with local network IPs (e.g., `https://192.168.1.183:3443`)

- **Local Font Awesome**: Self-hosted Font Awesome 6.4.0 assets
  - No external CDN dependencies
  - Assets stored in `assets/fontawesome/` directory
  - Includes all.min.css and webfonts (woff2, ttf)
  - Faster loading and offline support

- **Custom Domain Support**: Enhanced CORS configuration
  - Supports reverse proxy deployments with custom domains
  - Automatic domain name validation
  - Works with Nginx, Caddy, Traefik, Apache reverse proxies

- **Auto Database Migration**: Schema updates applied automatically
  - Missing columns added on server startup
  - Unique constraints via indexes (SQLite compatible)
  - No manual intervention required for schema updates

### Changed
- **Rate Limiting**: Updated static file rate limiter
  - Font files (.woff2, .woff, .ttf, .eot) now exempt from rate limiting
  - Prevents 500 errors when loading font assets

- **CORS Policy**: Relaxed for broader deployment scenarios
  - Added support for any valid domain name
  - Maintains security for localhost and local network IPs
  - Environment variable override available (`ALLOW_ALL_ORIGINS`)

### Fixed
- Database schema migration errors with UNIQUE columns
- Font file loading blocked by rate limiter
- CORS errors when accessing via custom domains
- Username column missing in users table on existing deployments

### Documentation
- Updated README.md with HTTPS setup instructions
- Enhanced DEPLOYMENT.md with reverse proxy configurations
- Added comprehensive reverse proxy examples (Nginx, Caddy, Traefik, Apache)
- Documented self-signed certificate acceptance process
- Added CORS configuration details

### Docker
- Updated Dockerfile to include `assets/` directory
- Added `landio_certs` volume for certificate persistence
- Modified healthcheck to use HTTPS endpoint
- Exposed both ports 3001 (HTTP) and 3443 (HTTPS)

## [1.0.0] - 2024-12-XX

### Initial Release
- Full-featured server management dashboard
- Two-factor authentication (2FA)
- Role-based access control (RBAC)
- Service monitoring and management
- User management
- Theme customization
- Email and Discord notifications
- SQLite database
- Docker support
