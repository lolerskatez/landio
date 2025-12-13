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

# Global variables for prerequisite status
DOCKER_INSTALLED=false
COMPOSE_AVAILABLE=false
COMPOSE_TYPE=""

check_prerequisites() {
    log_info "Checking prerequisites..."

    local missing_prereqs=()

    # Check git
    if command -v git >/dev/null 2>&1; then
        log_success "Git is installed: $(git --version)"
    else
        missing_prereqs+=("git")
        log_warning "Git is not installed"
    fi

    # Check openssl
    if command -v openssl >/dev/null 2>&1; then
        log_success "OpenSSL is installed: $(openssl version | head -1)"
    else
        missing_prereqs+=("openssl")
        log_warning "OpenSSL is not installed"
    fi

    # Check curl
    if command -v curl >/dev/null 2>&1; then
        log_success "curl is installed: $(curl --version | head -1)"
    else
        missing_prereqs+=("curl")
        log_warning "curl is not installed"
    fi

    # Check Docker
    if command -v docker >/dev/null 2>&1; then
        log_success "Docker is installed: $(docker --version)"
        DOCKER_INSTALLED=true
    else
        missing_prereqs+=("docker")
        log_warning "Docker is not installed"
        DOCKER_INSTALLED=false
    fi

    # Check Docker Compose (plugin or standalone)
    if [[ "$DOCKER_INSTALLED" == true ]]; then
        if docker compose version >/dev/null 2>&1; then
            log_success "Docker Compose plugin is available: $(docker compose version)"
            COMPOSE_AVAILABLE=true
            COMPOSE_TYPE="plugin"
        elif command -v docker-compose >/dev/null 2>&1; then
            log_success "Docker Compose standalone is available: $(docker-compose --version)"
            COMPOSE_AVAILABLE=true
            COMPOSE_TYPE="standalone"
        else
            missing_prereqs+=("docker-compose")
            log_warning "Docker Compose is not available"
            COMPOSE_AVAILABLE=false
        fi
    fi

    if [[ ${#missing_prereqs[@]} -eq 0 ]]; then
        log_success "All prerequisites are installed!"
        return 0
    else
        log_warning "Missing prerequisites: ${missing_prereqs[*]}"
        return 1
    fi
}

offer_installation() {
    echo
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                        PREREQUISITE INSTALLATION                            ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo
    echo "Some prerequisites are missing or could be upgraded."
    echo
    echo "This script can install/upgrade the following:"
    echo "  • Git (version control)"
    echo "  • OpenSSL (secure secret generation)"
    echo "  • curl (HTTP client)"
    echo "  • Docker (container runtime)"
    echo "  • Docker Compose (container orchestration)"
    echo
    read -p "Would you like to install/upgrade missing prerequisites? (y/N): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        return 0
    else
        echo
        log_warning "Skipping prerequisite installation."
        echo "Please ensure you have the following installed:"
        echo "  - git, openssl, curl"
        echo "  - Docker and Docker Compose"
        echo "  - Current user in docker group (may require logout/login)"
        echo
        read -p "Continue with deployment anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Deployment cancelled by user."
            exit 0
        fi
        return 1
    fi
}

install_prerequisites() {
    log_info "Installing missing prerequisites..."

    local packages_to_install=()

    # Check what needs to be installed
    if ! command -v git >/dev/null 2>&1; then
        packages_to_install+=("git")
    fi

    if ! command -v openssl >/dev/null 2>&1; then
        packages_to_install+=("openssl")
    fi

    if ! command -v curl >/dev/null 2>&1; then
        packages_to_install+=("curl")
    fi

    # Install basic packages if needed
    if [[ ${#packages_to_install[@]} -gt 0 ]]; then
        log_info "Installing basic packages: ${packages_to_install[*]}"
        sudo apt update
        sudo apt install -y "${packages_to_install[@]}"
    fi

    # Install Docker if not present
    if [[ "$DOCKER_INSTALLED" == false ]]; then
        log_info "Installing Docker using official repository..."

        # Update package list if not already done
        if [[ ${#packages_to_install[@]} -eq 0 ]]; then
            sudo apt update
        fi

        # Remove any conflicting packages
        sudo apt remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

        # Install prerequisites for Docker
        sudo apt install -y ca-certificates gnupg lsb-release

        # Add Docker's official GPG key
        sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

        # Set up Docker repository
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        # Update package list again
        sudo apt update

        # Install Docker packages
        sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        # Enable and start Docker service
        sudo systemctl enable docker
        sudo systemctl start docker

        # Add current user to docker group (optional, requires logout/login)
        sudo usermod -aG docker $USER

        # Verify Docker installation
        if docker --version >/dev/null 2>&1; then
            log_success "Docker installed successfully: $(docker --version)"
            DOCKER_INSTALLED=true
        else
            log_error "Docker installation failed"
            exit 1
        fi
    fi

    # Install Docker Compose if not available
    if [[ "$COMPOSE_AVAILABLE" == false && "$DOCKER_INSTALLED" == true ]]; then
        log_info "Installing Docker Compose..."

        # Try to install the plugin first (comes with Docker CE)
        if ! docker compose version >/dev/null 2>&1; then
            log_warning "Docker Compose plugin not available, installing standalone version..."
            sudo apt install -y docker-compose
        fi

        # Verify Docker Compose installation
        if docker compose version >/dev/null 2>&1; then
            log_success "Docker Compose plugin installed: $(docker compose version)"
            COMPOSE_AVAILABLE=true
            COMPOSE_TYPE="plugin"
        elif command -v docker-compose >/dev/null 2>&1; then
            log_success "Docker Compose standalone installed: $(docker-compose --version)"
            COMPOSE_AVAILABLE=true
            COMPOSE_TYPE="standalone"
        else
            log_error "Failed to install Docker Compose"
            exit 1
        fi
    fi

    log_success "Prerequisites installation completed"
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

    # Build and start containers using detected compose command
    if [[ "$COMPOSE_TYPE" == "plugin" ]]; then
        sudo docker compose up -d --build
        COMPOSE_CMD="docker compose"
    elif [[ "$COMPOSE_TYPE" == "standalone" ]]; then
        sudo docker-compose up -d --build
        COMPOSE_CMD="docker-compose"
    else
        log_error "Docker Compose is not available. Please install Docker Compose first."
        exit 1
    fi

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
    echo "   http://$(hostname -I | awk '{print $1}'):$APP_PORT"
    echo "   http://localhost:$APP_PORT"
    echo
    echo "📋 Useful commands:"
    echo "   cd $REPO_NAME"
    echo "   sudo $COMPOSE_CMD logs -f          # View logs"
    echo "   sudo $COMPOSE_CMD restart          # Restart services"
    echo "   sudo $COMPOSE_CMD down             # Stop services"
    echo "   sudo $COMPOSE_CMD pull && sudo $COMPOSE_CMD up -d  # Update"
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

    # Check prerequisites and offer installation
    if ! check_prerequisites; then
        if offer_installation; then
            install_prerequisites
        fi
    fi

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
        echo "  1. Check for required prerequisites (Docker, git, openssl, curl)"
        echo "  2. Optionally install missing prerequisites (with user confirmation)"
        echo "  3. Clone or update the Landio repository"
        echo "  4. Generate secure JWT and session secrets"
        echo "  5. Start the application with Docker Compose"
        echo "  6. Verify the deployment is working"
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