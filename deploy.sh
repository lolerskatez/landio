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

check_docker() {
    log_info "Checking Docker installation..."

    # Check if Docker is installed
    if command -v docker >/dev/null 2>&1; then
        log_success "Docker is installed: $(docker --version)"

        # Check if Docker Compose is available (plugin or standalone)
        if docker compose version >/dev/null 2>&1; then
            log_success "Docker Compose plugin is available: $(docker compose version)"
            COMPOSE_CMD="docker compose"
        elif command -v docker-compose >/dev/null 2>&1; then
            log_success "Docker Compose standalone is available: $(docker-compose --version)"
            COMPOSE_CMD="docker-compose"
        else
            log_error "Docker Compose is not available."
            echo
            echo "Please install Docker Compose:"
            echo "  Ubuntu/Debian: sudo apt install docker-compose-plugin"
            echo "  Or: sudo apt install docker-compose"
            echo
            echo "Then run this script again."
            exit 1
        fi

        # Check if Docker daemon is running
        if ! docker info >/dev/null 2>&1; then
            log_error "Docker daemon is not running."
            echo
            echo "Please start Docker:"
            echo "  sudo systemctl start docker"
            echo "  sudo systemctl enable docker"
            echo
            echo "Then run this script again."
            exit 1
        fi

        return 0
    else
        log_error "Docker is not installed."
        echo
        echo "╔══════════════════════════════════════════════════════════════════════════════╗"
        echo "║                           DOCKER INSTALLATION REQUIRED                      ║"
        echo "╚══════════════════════════════════════════════════════════════════════════════╝"
        echo
        echo "This script requires Docker to be installed. Please install Docker first:"
        echo
        echo "📋 Ubuntu/Debian Installation:"
        echo "  # Remove any conflicting packages"
        echo "  sudo apt remove -y docker docker-engine docker.io containerd runc"
        echo
        echo "  # Install Docker using official repository"
        echo "  sudo apt update"
        echo "  sudo apt install -y ca-certificates curl gnupg lsb-release"
        echo "  sudo mkdir -p /etc/apt/keyrings"
        echo "  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg"
        echo "  echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \$(lsb_release -cs) stable\" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null"
        echo "  sudo apt update"
        echo "  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
        echo
        echo "  # Start and enable Docker"
        echo "  sudo systemctl enable docker"
        echo "  sudo systemctl start docker"
        echo "  sudo usermod -aG docker \$USER"
        echo
        echo "  # Log out and back in, or run: newgrp docker"
        echo
        echo "🔗 For other operating systems, visit: https://docs.docker.com/get-docker/"
        echo
        echo "After installing Docker, run this script again: ./deploy.sh"
        exit 1
    fi
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
    sed -i "s|your-super-secret-jwt-key-change-this-in-production|$JWT_SECRET|g" .env
    sed -i "s|your-super-secret-session-key-change-this-in-production|$SESSION_SECRET|g" .env

    log_success "Environment configured with secure secrets"
}

start_services() {
    log_info "Starting Docker services..."

    # Build and start containers
    sudo $COMPOSE_CMD up -d --build

    log_success "Docker services started"
}

check_deployment() {
    log_info "Checking deployment status..."

    # Wait a moment for services to start
    sleep 10

    # Check if container is running
    if sudo $COMPOSE_CMD ps | grep -q "Up"; then
        log_success "Container is running"

        # Get container IP/port info
        CONTAINER_INFO=$(sudo $COMPOSE_CMD ps)
        echo "$CONTAINER_INFO"

        # Try to connect to health endpoint
        if curl -f -s "http://localhost:$APP_PORT" > /dev/null 2>&1; then
            log_success "Application is responding on port $APP_PORT"
        else
            log_warning "Application may still be starting up. Check logs with: $COMPOSE_CMD logs -f"
        fi
    else
        log_error "Container failed to start. Check logs with: $COMPOSE_CMD logs"
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
    echo "   https://$(hostname -I | awk '{print $1}'):3443 (HTTPS - recommended)"
    echo "   http://$(hostname -I | awk '{print $1}'):3001 (HTTP - redirects to HTTPS)"
    echo "   https://localhost:3443"
    echo
    echo "   ⚠️  Note: You'll see a certificate warning on first access."
    echo "       This is normal for self-signed certificates. Click 'Advanced' and proceed."
    echo
    echo "📋 Useful commands:"
    echo "   cd $REPO_NAME"
    echo "   sudo $COMPOSE_CMD logs -f          # View logs"
    echo "   sudo $COMPOSE_CMD restart          # Restart services"
    echo "   sudo $COMPOSE_CMD down             # Stop services"
    echo "   sudo $COMPOSE_CMD pull && sudo $COMPOSE_CMD up -d  # Update"
    echo
    echo "🔒 Initial setup:"
    echo "   1. Navigate to https://your-server:3443/setup.html"
    echo "   2. Accept the self-signed certificate warning"
    echo "   3. Create your admin account"
    echo "   4. Configure 2FA and other settings"
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
    check_docker

    # Deployment steps
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
        echo "  1. Check that Docker and Docker Compose are installed and running"
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