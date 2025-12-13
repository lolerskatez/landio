#!/bin/bash

# Landio Docker Deployment Script
# This script automates the complete deployment of Landio on Ubuntu

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/lolerskatez/landio.git"
REPO_NAME="landio"
APP_PORT=3001

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "This script should not be run as root. Please run as a regular user with sudo privileges."
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        log_error "This script is designed for Ubuntu/Debian systems only."
        exit 1
    fi

    . /etc/os-release
    if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
        log_warning "This script is designed for Ubuntu/Debian but detected $ID. Continuing anyway..."
    fi
}

install_prerequisites() {
    log_info "Installing prerequisites (git, docker, docker-compose, openssl)..."

    # Update package list
    sudo apt update

    # Install packages
    sudo apt install -y git docker.io docker-compose openssl curl

    # Enable and start Docker service
    sudo systemctl enable docker
    sudo systemctl start docker

    # Add current user to docker group (optional, requires logout/login)
    sudo usermod -aG docker $USER

    log_success "Prerequisites installed successfully"
}

clone_repository() {
    log_info "Cloning Landio repository..."

    if [[ -d "$REPO_NAME" ]]; then
        log_warning "Directory '$REPO_NAME' already exists. Pulling latest changes..."
        cd "$REPO_NAME"
        git pull origin master
        cd ..
    else
        git clone "$REPO_URL"
    fi

    log_success "Repository ready"
}

setup_environment() {
    log_info "Setting up environment configuration..."

    cd "$REPO_NAME"

    # Copy environment template
    if [[ ! -f ".env" ]]; then
        cp .env.example .env
        log_info "Created .env file from template"
    else
        log_warning ".env file already exists, skipping copy"
    fi

    # Generate secure secrets
    JWT_SECRET=$(openssl rand -base64 32)
    SESSION_SECRET=$(openssl rand -base64 32)

    # Update .env file with generated secrets
    sed -i "s|your-jwt-secret-change-in-production|$JWT_SECRET|g" .env
    sed -i "s|your-session-secret-change-in-production|$SESSION_SECRET|g" .env

    log_success "Environment configured with secure secrets"
}

start_services() {
    log_info "Starting Docker services..."

    # Build and start containers
    sudo docker-compose up -d --build

    log_success "Docker services started"
}

check_deployment() {
    log_info "Checking deployment status..."

    # Wait a moment for services to start
    sleep 10

    # Check if container is running
    if sudo docker-compose ps | grep -q "Up"; then
        log_success "Container is running"

        # Get container IP/port info
        CONTAINER_INFO=$(sudo docker-compose ps)
        echo "$CONTAINER_INFO"

        # Try to connect to health endpoint
        if curl -f -s "http://localhost:$APP_PORT" > /dev/null 2>&1; then
            log_success "Application is responding on port $APP_PORT"
        else
            log_warning "Application may still be starting up. Check logs with: docker-compose logs -f"
        fi
    else
        log_error "Container failed to start. Check logs with: docker-compose logs"
        exit 1
    fi
}

show_next_steps() {
    echo
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                           DEPLOYMENT COMPLETE!                              ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo
    log_success "Landio has been deployed successfully!"
    echo
    echo "🌐 Access your application at:"
    echo "   http://$(hostname -I | awk '{print $1}'):$APP_PORT"
    echo "   http://localhost:$APP_PORT"
    echo
    echo "📋 Useful commands:"
    echo "   cd $REPO_NAME"
    echo "   sudo docker-compose logs -f          # View logs"
    echo "   sudo docker-compose restart          # Restart services"
    echo "   sudo docker-compose down             # Stop services"
    echo "   sudo docker-compose pull && sudo docker-compose up -d  # Update"
    echo
    echo "🔒 Initial setup:"
    echo "   1. Navigate to http://your-server:$APP_PORT/setup.html"
    echo "   2. Create your admin account"
    echo "   3. Configure 2FA and other settings"
    echo
    echo "📚 Documentation:"
    echo "   - DOCKER.md     - Docker deployment guide"
    echo "   - ARCHITECTURE.md - Technical documentation"
    echo "   - README.md     - Project overview"
    echo
    echo "⚠️  Note: You may need to log out and back in for Docker group changes to take effect"
}

main() {
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                    LANDIO DOCKER DEPLOYMENT SCRIPT                          ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo

    # Pre-flight checks
    check_root
    check_os

    # Deployment steps
    install_prerequisites
    clone_repository
    setup_environment
    start_services
    check_deployment

    # Show completion info
    show_next_steps
}

# Handle command line arguments
case "${1:-}" in
    "--help"|"-h")
        echo "Landio Docker Deployment Script"
        echo
        echo "Usage: $0 [options]"
        echo
        echo "Options:"
        echo "  --help, -h    Show this help message"
        echo "  --no-pull     Skip git pull if repository exists"
        echo
        echo "This script will:"
        echo "  1. Install Docker, docker-compose, git, and openssl"
        echo "  2. Clone or update the Landio repository"
        echo "  3. Generate secure JWT and session secrets"
        echo "  4. Start the application with Docker Compose"
        echo "  5. Verify the deployment is working"
        echo
        exit 0
        ;;
    "--no-pull")
        SKIP_PULL=true
        ;;
    *)
        ;;
esac

# Run main function
main "$@"