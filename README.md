# Landio - Server Dashboard & Services Portal

A modern, full-featured server management dashboard with two-factor authentication, role-based access control, real-time service monitoring, and comprehensive admin settings management.

## 📋 Documentation

- **[README.md](README.md)** - This file, project overview and quick start
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical architecture and system design
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete deployment guide for all platforms
- **.env.example** - Environment configuration template
- **LICENSE** - MIT License

## Features

### Core Functionality
- **Dual Dashboard Interface**: Separate admin and user dashboards with role-based access
- **Service Management**: Monitor, start, stop, and manage services with real-time status
- **User Management**: Create, edit, disable users with role assignment (admin/standard)
- **Two-Factor Authentication (2FA)**: TOTP-based 2FA with backup codes for enhanced security
- **Settings Management**: Comprehensive system and user settings with appearance customization

### Security
- **JWT Authentication**: Secure token-based authentication with automatic refresh
- **2FA Enforcement**: Require 2FA for all users with configurable enforcement
- **Role-Based Access Control (RBAC)**: Admin and standard user roles with appropriate permissions
- **Session Management**: Configurable session timeout with secure token expiration
- **Password Security**: Bcrypt hashing, password change functionality

### User Experience
- **Dark/Light Theme**: Multiple theme options (pastel, cyber, mocha, ice, nature, sunset)
- **Accessibility**: Font size options, high contrast mode, reduce motion support
- **Real-time Notifications**: Email and Discord notifications for system events
- **Responsive Design**: Mobile-friendly interface that works on all devices
- **Appearance Settings**: Customizable UI with border radius, compact mode options

### Administrative Features
- **Logs Viewer**: View system and activity logs with filtering
- **SMTP Configuration**: Email notification setup
- **Discord Webhooks**: Discord integration for alerts
- **Notification Settings**: Fine-grained control over alert types and delivery
- **System Health**: Performance monitoring and system status dashboard

## Quick Start

### Prerequisites
- Node.js 14+ 
- npm or yarn
- SQLite3 (included with npm package)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd landio
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Initialize the database**
   ```bash
   npm run init-db
   ```

4. **Start the server**
   ```bash
   npm start
   ```

   The application will be available at `http://localhost:3001`

### Development

For development with hot-reload:
```bash
npm run dev
```

## Initial Setup

1. Navigate to `http://localhost:3001/setup.html`
2. Create the initial admin account
3. Complete 2FA enrollment (recommended)
4. Access the admin dashboard at `http://localhost:3001/index.html`

## User Roles

### Admin
- Full access to all features
- User management capabilities
- System settings configuration
- Service management
- Logs access
- Notification settings

### Standard User
- View personal dashboard
- View assigned services
- Manage personal settings and 2FA
- View activity logs (personal only)

## Two-Factor Authentication (2FA)

### For Users
1. Navigate to Settings → Appearance → 2FA Setup
2. Scan QR code with authenticator app (Google Authenticator, Authy, etc.)
3. Enter verification code
4. Save backup codes in a secure location
5. 2FA is now enabled and will be required at login

### Admin Configuration
- **Enforcement**: Require 2FA for all users
- **Verification**: Monitor user 2FA status
- **Bypass**: Disable 2FA for users if needed

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/change-password` - Change password

### 2FA
- `POST /api/2fa/setup` - Generate 2FA QR code
- `POST /api/2fa/verify` - Verify 2FA setup
- `POST /api/2fa/verify-login` - Verify 2FA at login
- `POST /api/2fa/disable` - Disable 2FA

### Users
- `GET /api/users` - List all users (admin only)
- `POST /api/users` - Create new user (admin only)
- `PUT /api/users/:id` - Update user (admin only)
- `DELETE /api/users/:id` - Delete user (admin only)

### Settings
- `GET /api/settings` - Get all settings
- `GET /api/settings/:key` - Get specific setting
- `POST /api/settings` - Create/update setting
- `DELETE /api/settings/:key` - Delete setting
- `GET /api/settings/theme/preferences` - Get user theme preferences
- `POST /api/settings/theme/preferences` - Save user theme preferences

### Services
- `GET /api/services` - List all services
- `POST /api/services/:name/start` - Start service
- `POST /api/services/:name/stop` - Stop service
- `GET /api/services/:name/status` - Get service status

### Notifications
- `GET /api/notifications` - Get notification settings
- `POST /api/notifications` - Update notification settings
- `POST /api/notifications/test` - Test notification

## Configuration

### Environment Variables
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your configuration:
   ```env
   PORT=3001
   NODE_ENV=development
   JWT_SECRET=your-super-secret-key
   SESSION_SECRET=your-session-secret
   SMTP_ENABLED=false
   DISCORD_ENABLED=false
   ```

3. See `.env.example` for all available options

### Database
- SQLite database stored in `database.db`
- Automatically initialized on first run
- Settings table stores system and user preferences

## Deployment

LandIO supports multiple deployment options:

- **Local Development** - Development with hot-reload
- **Docker** - Containerized deployment
- **Linux (Ubuntu/Debian)** - Traditional server deployment
- **Windows Server** - IIS deployment
- **Cloud Platforms** - Heroku, DigitalOcean, AWS, Google Cloud

**See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive deployment guides.**

## CI/CD Pipeline

GitHub Actions automatically tests and builds on every push:
- Runs tests on Node.js 14, 16, and 18
- Performs security vulnerability checks
- Builds artifacts for staging/production

Configure GitHub Secrets for automatic deployment (see `.github/workflows/ci.yml`)

## Customization

### Themes
Located in `theme.js` - Customize colors and styling for different themes

### Appearance Settings
Modify in `settings.html` - Add new appearance options and UI customizations

### Services
Edit service list in routes or frontend configuration

## Troubleshooting

### Database Issues
If you encounter database errors, reinitialize:
```bash
rm database.db
npm run init-db
npm start
```

### 2FA Problems
- Verify server time is correct (TOTP is time-sensitive)
- Use backup codes if authenticator is unavailable
- Check system logs for detailed error messages

### Login Issues
- Clear browser cookies and localStorage
- Check database connection
- Verify user account exists and is enabled

## Security Best Practices

1. **Change JWT_SECRET** in production
2. **Use HTTPS** in production environments
3. **Enable 2FA** for all admin accounts
4. **Regular backups** of database
5. **Monitor logs** for suspicious activity
6. **Keep dependencies updated**

## Support & Documentation

- **Architecture Details**: See [ARCHITECTURE.md](ARCHITECTURE.md) for system design
- **Deployment Guides**: See [DEPLOYMENT.md](DEPLOYMENT.md) for server setup
- **Environment Config**: See [.env.example](.env.example) for all options
- **Server Logs**: Check console output and system logs
- **Debug Mode**: Set `NODE_ENV=development` for verbose logging
- **GitHub Issues**: Report bugs at https://github.com/yourusername/landio/issues

## License

MIT - See [LICENSE](LICENSE) for full text

## Contributing

Contributions are welcome. Please ensure all features are tested before submitting.
