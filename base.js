/**
 * Base Template System
 * Provides consistent navigation bar across all pages
 * Handles authentication, authorization, and user info display
 */

// Configuration for each page
const PAGE_CONFIG = {
    'dashboard.html': {
        brand: 'Services Portal',
        icon: 'th-large',
        pageType: 'user' // or 'admin'
    },
    'index.html': {
        brand: 'Admin Dashboard',
        icon: 'th-large',
        pageType: 'admin'
    },
    'settings.html': {
        brand: 'Settings',
        icon: 'cog',
        pageType: 'admin'
    },
    'manage-services.html': {
        brand: 'Manage Services',
        icon: 'cube',
        pageType: 'admin'
    },
    'user-management.html': {
        brand: 'User Management',
        icon: 'users',
        pageType: 'admin'
    },
    'logs.html': {
        brand: 'System Logs',
        icon: 'list-alt',
        pageType: 'admin'
    }
};

/**
 * Initialize the page with navigation and authentication
 * Call this in each page's DOMContentLoaded event
 */
function initializePage() {
    // Load required scripts
    Promise.all([
        loadScript('api.js'),
        loadScript('auth.js'),
        loadScript('nav.js')
    ]).then(async () => {
        // Get current page config
        const currentPage = getCurrentPage();
        const config = PAGE_CONFIG[currentPage] || { brand: 'Dashboard', icon: 'home', pageType: 'user' };

        // Inject the navigation bar
        injectNavBar(config);

        // Check authentication
        const user = window.Auth.requireAuth();
        if (!user) return;

        // Initialize navigation with proper active state
        if (window.initializeNavigation && typeof window.initializeNavigation === 'function') {
            window.initializeNavigation();
        }

        // Load user info
        populateUserInfo(user);

        // Call page-specific init if it exists
        if (window.pageInit && typeof window.pageInit === 'function') {
            window.pageInit(user);
        }
    }).catch(err => console.error('Error initializing page:', err));
}

/**
 * Get current page filename
 */
function getCurrentPage() {
    const path = window.location.pathname;
    const lastSlash = path.lastIndexOf('/');
    const filename = lastSlash === -1 ? path : path.substring(lastSlash + 1);
    return filename || 'index.html';
}

/**
 * Load a script dynamically
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
    });
}

/**
 * Inject the top navigation bar into the page
 * Looks for an element with id="nav-container" or creates one
 */
function injectNavBar(config) {
    let navContainer = document.getElementById('nav-container');
    
    if (!navContainer) {
        // Create nav container if it doesn't exist
        navContainer = document.createElement('nav');
        navContainer.id = 'nav-container';
        navContainer.className = 'top-nav-bar';
        
        // Find the container div and insert nav as first child
        const containerDiv = document.querySelector('.container');
        if (containerDiv) {
            containerDiv.insertBefore(navContainer, containerDiv.firstChild);
        } else {
            // Fallback: insert as first child of body
            document.body.insertBefore(navContainer, document.body.firstChild);
        }
    }

    // Generate the nav bar HTML
    const navHTML = `
        <div class="top-nav-left">
            <div class="nav-brand">
                <i class="fas fa-${config.icon}"></i>
                <span>${config.brand}</span>
            </div>
        </div>

        <div class="nav" id="main-nav">
            <!-- Navigation will be populated by nav.js -->
        </div>

        <div class="top-nav-right">
            <!-- User info and logout will be added here -->
        </div>
    `;

    navContainer.innerHTML = navHTML;

    // Inject required CSS if not already present
    injectNavBarCSS();
}

/**
 * Inject the navigation bar CSS
 */
function injectNavBarCSS() {
    // Check if CSS already exists
    if (document.getElementById('base-nav-css')) {
        return;
    }

    const style = document.createElement('style');
    style.id = 'base-nav-css';
    style.textContent = `
        /* Top Navigation Bar */
        .top-nav-bar {
            background: rgba(255, 255, 255, 0.95);
            -webkit-backdrop-filter: blur(10px);
            backdrop-filter: blur(10px);
            border-bottom: 3px solid var(--primary, #ff6b93);
            padding: 15px 30px;
            margin-bottom: 30px;
            border-radius: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 5px 20px rgba(0, 0, 0, 0.08);
            position: relative;
            z-index: 1000;
        }

        .top-nav-left {
            display: flex;
            align-items: center;
            gap: 30px;
        }

        .nav-brand {
            font-size: 1.3rem;
            font-weight: bold;
            color: var(--primary, #ff6b93);
            display: flex;
            align-items: center;
            gap: 10px;
            white-space: nowrap;
        }

        .nav-brand i {
            font-size: 1.5rem;
        }

        /* Navigation Center */
        #main-nav {
            display: flex;
            justify-content: center;
            gap: 10px;
            flex-wrap: wrap;
        }

        .nav-btn {
            padding: 8px 16px;
            background: rgba(166, 216, 255, 0.7);
            color: #3a7bb8;
            border: 1px solid rgba(166, 216, 255, 0.5);
            border-radius: 25px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 6px;
            text-decoration: none;
            font-size: 0.9rem;
            white-space: nowrap;
        }

        .nav-btn:hover {
            background: #8bcaff;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(166, 216, 255, 0.3);
        }

        .nav-btn.active,
        .dropdown-btn.active {
            background: var(--primary, #ff6b93) !important;
            color: white !important;
            border-color: var(--primary, #ff6b93) !important;
            box-shadow: 0 4px 12px rgba(255, 107, 147, 0.3) !important;
        }

        .user-info-btn {
            background: rgba(255, 182, 193, 0.3) !important;
            border: 1px solid rgba(255, 182, 193, 0.5) !important;
            opacity: 1 !important;
            cursor: default !important;
            padding: 8px 12px !important;
        }

        .user-info-btn:hover {
            transform: none !important;
            background: rgba(255, 182, 193, 0.3) !important;
        }

        .user-info-btn span {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-direction: column;
            text-align: right;
            font-size: 0.8rem;
        }

        .user-name {
            font-weight: bold;
        }

        .user-role {
            font-size: 0.7rem;
            opacity: 0.8;
        }

        .logout-btn {
            background: #ffe8e8 !important;
            color: #c62828 !important;
            border-color: #ffe8e8 !important;
        }

        .logout-btn:hover {
            background: #ffcccc !important;
        }

        /* User Dropdown Styles */
        .user-dropdown-container {
            position: relative;
            display: inline-block;
        }

        .user-dropdown-btn {
            background: transparent;
            border: 2px solid var(--primary, #ff6b93);
            cursor: pointer;
            padding: 10px 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--text, #5a5a5a);
            border-radius: 25px;
            font-weight: 600;
            transition: all 0.3s ease;
            font-size: 0.95rem;
        }

        .user-dropdown-btn:hover {
            background: var(--primary, #ff6b93);
            color: white;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .user-dropdown-btn .user-name {
            font-size: 0.95rem;
            font-weight: 600;
        }

        .user-dropdown-arrow {
            font-size: 0.7rem;
            transition: transform 0.2s ease;
        }

        .user-dropdown-btn:hover .user-dropdown-arrow {
            transform: rotate(180deg);
        }

        .user-dropdown-menu {
            position: absolute;
            top: 100%;
            right: 0;
            background: white;
            border: 2px solid var(--primary, #ff6b93);
            border-radius: 12px;
            min-width: 180px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
            z-index: 2000;
            display: none;
            flex-direction: column;
            overflow: hidden;
            margin-top: 8px;
        }

        .user-dropdown-menu.show {
            display: flex;
        }

        .user-dropdown-item {
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            text-decoration: none;
            color: #5a5a5a;
            font-size: 0.9rem;
            transition: all 0.2s ease;
            border-bottom: 1px solid rgba(255, 107, 147, 0.1);
        }

        .user-dropdown-item:last-child {
            border-bottom: none;
        }

        .user-dropdown-item:hover {
            background: rgba(255, 107, 147, 0.05);
            color: var(--primary, #ff6b93);
        }

        .user-dropdown-item.logout-item {
            color: #c62828;
            border-top: 1px solid rgba(198, 40, 40, 0.1);
        }

        .user-dropdown-item.logout-item:hover {
            background: rgba(198, 40, 40, 0.05);
            color: #c62828;
        }

        .user-dropdown-item i {
            width: 16px;
            text-align: center;
        }

        /* Theme-specific modal styling */
        body.theme-pastel .profile-modal-content {
            border-color: rgba(255, 130, 169, 0.3);
        }

        body.theme-pastel .profile-form-group input,
        body.theme-pastel .profile-form-group select {
            background: rgba(255, 255, 255, 0.95);
            border-color: rgba(255, 130, 169, 0.4);
        }

        body.theme-pastel .profile-form-group input:focus,
        body.theme-pastel .profile-form-group select:focus {
            border-color: #FF82A9;
        }

        body.theme-cyber .profile-modal-content {
            border-color: rgba(0, 224, 255, 0.5);
            background: rgba(28, 20, 51, 0.98);
            box-shadow: 0 0 40px rgba(0, 224, 255, 0.3);
        }

        body.theme-cyber .profile-modal-header {
            border-bottom-color: rgba(0, 224, 255, 0.3);
        }

        body.theme-cyber .profile-modal-title {
            color: #00E0FF;
            text-shadow: 0 0 10px rgba(0, 224, 255, 0.5);
        }

        body.theme-cyber .profile-form-group label {
            color: #00E0FF;
        }

        body.theme-cyber .profile-form-group input,
        body.theme-cyber .profile-form-group select {
            background: rgba(36, 26, 64, 0.8);
            border-color: rgba(0, 224, 255, 0.4);
            color: #FFFFFF;
        }

        body.theme-cyber .profile-form-group input:focus,
        body.theme-cyber .profile-form-group select:focus {
            background: rgba(36, 26, 64, 1);
            border-color: #00E0FF;
            box-shadow: 0 0 15px rgba(0, 224, 255, 0.3);
        }

        body.theme-cyber .profile-form-group input:disabled,
        body.theme-cyber .profile-form-group select:disabled {
            background: rgba(36, 26, 64, 0.5);
            color: rgba(201, 190, 234, 0.6);
        }

        body.theme-cyber .profile-avatar-section {
            background: linear-gradient(135deg, rgba(0, 224, 255, 0.1), rgba(255, 95, 162, 0.1));
            border-color: rgba(0, 224, 255, 0.3);
        }

        body.theme-cyber .profile-avatar-info {
            color: #C9BEEA;
        }

        body.theme-cyber .profile-btn-primary {
            background: linear-gradient(135deg, #FF5FA2, #C77DFF);
            box-shadow: 0 0 20px rgba(255, 95, 162, 0.4);
        }

        body.theme-cyber .profile-btn-primary:hover {
            box-shadow: 0 0 30px rgba(255, 95, 162, 0.6);
        }

        body.theme-cyber .profile-form-group small {
            color: rgba(0, 224, 255, 0.7);
        }

        /* User Dropdown - Cyber Theme */
        body.theme-cyber .user-dropdown-btn {
            background: rgba(28, 20, 51, 0.8) !important;
            border: 1px solid rgba(0, 224, 255, 0.4) !important;
        }

        body.theme-cyber .user-dropdown-btn:hover {
            background: rgba(28, 20, 51, 1) !important;
            border-color: rgba(0, 224, 255, 0.6) !important;
            box-shadow: 0 0 15px rgba(0, 224, 255, 0.2) !important;
        }

        body.theme-cyber .user-dropdown-btn .user-name {
            color: #00E0FF !important;
        }

        body.theme-cyber .user-dropdown-menu {
            background: rgba(28, 20, 51, 0.98) !important;
            border: 2px solid rgba(0, 224, 255, 0.5) !important;
            box-shadow: 0 8px 24px rgba(0, 224, 255, 0.3) !important;
        }

        body.theme-cyber .user-dropdown-item {
            color: #C9BEEA !important;
            border-bottom-color: rgba(0, 224, 255, 0.1) !important;
        }

        body.theme-cyber .user-dropdown-item:hover {
            background: rgba(0, 224, 255, 0.1) !important;
            color: #00E0FF !important;
        }

        body.theme-cyber .user-dropdown-item.logout-item {
            color: #FF4F70 !important;
            border-top-color: rgba(255, 79, 112, 0.2) !important;
        }

        body.theme-cyber .user-dropdown-item.logout-item:hover {
            background: rgba(255, 79, 112, 0.1) !important;
            color: #FF4F70 !important;
        }

        body.theme-mocha .profile-modal-content {
            border-color: rgba(199, 147, 109, 0.3);
            background: rgba(252, 249, 245, 0.98);
        }

        body.theme-mocha .profile-form-group input,
        body.theme-mocha .profile-form-group select {
            background: rgba(255, 255, 255, 0.9);
            border-color: rgba(199, 147, 109, 0.4);
        }

        body.theme-mocha .profile-form-group input:focus,
        body.theme-mocha .profile-form-group select:focus {
            border-color: #C7936D;
        }

        body.theme-ice .profile-modal-content {
            border-color: rgba(74, 144, 226, 0.3);
            background: rgba(240, 250, 255, 0.98);
        }

        body.theme-ice .profile-form-group input,
        body.theme-ice .profile-form-group select {
            background: rgba(255, 255, 255, 0.9);
            border-color: rgba(74, 144, 226, 0.4);
        }

        body.theme-ice .profile-form-group input:focus,
        body.theme-ice .profile-form-group select:focus {
            border-color: #4A90E2;
        }

        body.theme-nature .profile-modal-content {
            border-color: rgba(125, 198, 125, 0.3);
            background: rgba(245, 255, 245, 0.98);
        }

        body.theme-nature .profile-form-group input,
        body.theme-nature .profile-form-group select {
            background: rgba(255, 255, 255, 0.9);
            border-color: rgba(125, 198, 125, 0.4);
        }

        body.theme-nature .profile-form-group input:focus,
        body.theme-nature .profile-form-group select:focus {
            border-color: #7DC67D;
        }

        body.theme-sunset .profile-modal-content {
            border-color: rgba(255, 106, 61, 0.3);
            background: rgba(255, 250, 245, 0.98);
        }

        body.theme-sunset .profile-form-group input,
        body.theme-sunset .profile-form-group select {
            background: rgba(255, 255, 255, 0.9);
            border-color: rgba(255, 106, 61, 0.4);
        }

        body.theme-sunset .profile-form-group input:focus,
        body.theme-sunset .profile-form-group select:focus {
            border-color: #FF6A3D;
        }

        body.dark-mode .profile-modal-content {
            background: rgba(40, 40, 40, 0.95);
            border-color: rgba(255, 107, 147, 0.2);
        }

        body.dark-mode .profile-form-group input,
        body.dark-mode .profile-form-group select {
            background: rgba(60, 60, 60, 0.8);
            color: #ddd;
            border-color: rgba(255, 107, 147, 0.3);
        }

        body.dark-mode .profile-form-group input:focus,
        body.dark-mode .profile-form-group select:focus {
            background: rgba(60, 60, 60, 1);
            border-color: var(--primary, #ff6b93);
        }

        /* Ensure modal respects form styling from parent pages */
        .profile-modal-content .profile-form-group input[type="text"],
        .profile-modal-content .profile-form-group input[type="email"],
        .profile-modal-content .profile-form-group input[type="password"] {
            font-size: 1rem;
            padding: 14px 15px;
        }

        /* Fix form input appearance across all themes */
        .profile-modal-content input::placeholder {
            color: var(--text, #999);
            opacity: 0.6;
        }

        .profile-modal-content select option {
            background: var(--light-bg, white);
            color: var(--text, #5a5a5a);
        }

        /* Dark mode adjustments for select dropdown */
        body.dark-mode .profile-modal-content select option {
            background: rgba(60, 60, 60, 1);
            color: #ddd;
        }

        /* Profile Modal Styles */
        .profile-modal {
            display: none;
            position: fixed;
            z-index: 10000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            overflow: auto;
            background-color: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(5px);
        }

        .profile-modal.show {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .profile-modal-content {
            background: var(--light-bg, linear-gradient(135deg, #fff9fb, #fef7f8));
            padding: 30px;
            border-radius: 20px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 20px 40px rgba(255, 107, 147, 0.2);
            position: relative;
            max-height: 80vh;
            overflow-y: auto;
            border: 3px solid var(--accent, rgba(255, 182, 193, 0.3));
        }

        .profile-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
            padding-bottom: 15px;
            border-bottom: 2px solid var(--primary, #ff6b93);
        }

        .profile-modal-title {
            color: var(--primary, #ff6b93);
            font-size: 1.5rem;
            font-weight: bold;
            margin: 0;
        }

        .profile-modal-close {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #999;
            padding: 5px;
            border-radius: 50%;
            width: 35px;
            height: 35px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .profile-modal-close:hover {
            background: #f0f0f0;
            color: var(--primary, #ff6b93);
        }

        .profile-form-group {
            margin-bottom: 20px;
        }

        .profile-form-group label {
            display: block;
            margin-bottom: 8px;
            color: var(--primary, #ff6b93);
            font-weight: 600;
            font-size: 0.9rem;
            font-family: 'Arial Rounded MT Bold', 'Arial', sans-serif;
        }

        .profile-form-group small {
            color: rgba(255, 107, 147, 0.7);
            font-size: 0.8rem;
            margin-top: 5px;
            display: block;
        }

        .profile-form-group input[type="checkbox"] {
            width: auto;
            margin-right: 8px;
            transform: scale(1.2);
            accent-color: var(--primary, #ff6b93);
        }

        .profile-form-group label:has(input[type="checkbox"]) {
            display: flex;
            align-items: center;
            cursor: pointer;
            padding: 8px 12px;
            background: rgba(255, 182, 193, 0.1);
            border-radius: 10px;
            transition: all 0.2s ease;
        }

        .profile-form-group label:has(input[type="checkbox"]):hover {
            background: rgba(255, 182, 193, 0.2);
        }

        .profile-form-group input,
        .profile-form-group select {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid var(--accent, rgba(255, 182, 193, 0.4));
            border-radius: 12px;
            font-size: 0.9rem;
            transition: all 0.3s ease;
            box-sizing: border-box;
            background: var(--light-bg, rgba(255, 255, 255, 0.9));
            color: var(--text, #5a5a5a);
            font-family: 'Arial Rounded MT Bold', 'Arial', sans-serif;
        }

        .profile-form-group input:focus,
        .profile-form-group select:focus {
            outline: none;
            border-color: var(--primary, #ff6b93);
            box-shadow: 0 0 0 3px rgba(255, 107, 147, 0.15);
            background: var(--light-bg, rgba(255, 255, 255, 1));
        }

        .profile-form-group input:disabled,
        .profile-form-group select:disabled {
            background: rgba(128, 128, 128, 0.1);
            color: var(--text, #999);
            cursor: not-allowed;
        }

        .profile-form-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 25px;
        }

        .profile-btn {
            padding: 12px 24px;
            border: none;
            border-radius: 25px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9rem;
        }

        .profile-btn-primary {
            background: var(--primary, #ff6b93);
            color: white;
        }

        .profile-btn-primary:hover {
            background: #ff5a87;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(255, 107, 147, 0.3);
        }

        .profile-btn-secondary {
            background: #f0f0f0;
            color: var(--text, #5a5a5a);
        }

        .profile-btn-secondary:hover {
            background: #e0e0e0;
        }

        .profile-success-message,
        .profile-error-message {
            padding: 12px 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 0.9rem;
        }

        .profile-success-message {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }

        .profile-error-message {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }

        .profile-avatar-section {
            text-align: center;
            margin-bottom: 25px;
            padding: 20px;
            background: linear-gradient(135deg, rgba(255, 182, 193, 0.1), rgba(166, 216, 255, 0.1));
            border-radius: 15px;
            border: 2px solid var(--accent, rgba(255, 107, 147, 0.2));
        }

        .profile-avatar-preview {
            margin: 0 auto 15px;
        }

        .profile-avatar-info {
            color: var(--primary, #ff6b93);
            font-size: 0.85rem;
            font-weight: 600;
        }

        /* Dropdown Menu Styles */
        .nav-dropdown {
            position: relative;
            display: inline-block;
        }

        .dropdown-btn {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .dropdown-menu {
            position: absolute;
            top: 100%;
            left: 0;
            background: white;
            border: 2px solid var(--primary, #ff6b93);
            border-radius: 15px;
            min-width: 200px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
            z-index: 2000;
            display: none;
            flex-direction: column;
            overflow: hidden;
            margin-top: 8px;
        }

        .dropdown-menu.show {
            display: flex;
        }

        .dropdown-item {
            padding: 12px 16px;
            color: #5a5a5a;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: all 0.3s ease;
            border-left: 3px solid transparent;
            cursor: pointer;
            background: white;
        }

        .dropdown-item:hover {
            background: rgba(255, 182, 193, 0.2);
            color: var(--primary, #ff6b93);
            border-left-color: var(--primary, #ff6b93);
        }

        .dropdown-item.active {
            background: rgba(255, 182, 193, 0.3);
            color: var(--primary, #ff6b93);
            border-left-color: var(--primary, #ff6b93);
            font-weight: 600;
        }

        .dropdown-item i {
            width: 20px;
            text-align: center;
        }

        .top-nav-right {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .top-nav-bar {
                flex-direction: column;
                gap: 15px;
                padding: 12px 15px;
                margin-bottom: 20px;
            }

            .top-nav-left {
                width: 100%;
                justify-content: space-between;
                gap: 10px;
            }

            .nav-brand {
                font-size: 1.1rem;
            }

            .top-nav-right {
                width: 100%;
                justify-content: flex-end;
                gap: 10px;
            }

            #main-nav {
                width: 100%;
                flex-direction: column;
                gap: 8px;
            }

            .nav-btn {
                width: 100%;
                min-height: 44px;
                padding: 12px 16px;
                font-size: 0.9rem;
                justify-content: center;
            }

            .user-info-btn {
                width: auto;
                min-height: auto !important;
            }

            .logout-btn {
                width: auto;
            }

            /* Dropdown on mobile */
            .nav-dropdown {
                width: 100%;
            }

            .dropdown-btn {
                width: 100%;
                min-height: 44px;
                padding: 12px 16px;
                justify-content: center;
            }

            .dropdown-menu {
                position: static;
                width: auto;
                border-radius: 0;
                border-left: none;
                border-right: none;
                border-bottom: 2px solid var(--primary, #ff6b93);
                box-shadow: none;
                margin-top: 0;
            }

            .dropdown-menu.show {
                margin-top: 5px;
            }

            .dropdown-item {
                width: 100%;
                padding: 12px 20px;
                justify-content: flex-start;
            }
        }

        /* Theme-Aware Navbar Styles */
        body.theme-cyber .top-nav-bar {
            background: rgba(28, 20, 51, 0.95);
            border-bottom-color: rgba(255, 95, 162, 0.5);
            color: #FFFFFF;
        }

        body.theme-cyber .nav-brand {
            color: #FF9BD4;
        }

        body.theme-cyber .nav-btn {
            background: rgba(255, 95, 162, 0.15);
            color: #FF9BD4;
            border-color: rgba(255, 95, 162, 0.3);
        }

        body.theme-cyber .nav-btn:hover {
            background: rgba(255, 95, 162, 0.25);
            box-shadow: 0 4px 12px rgba(255, 95, 162, 0.4);
        }

        body.theme-cyber .nav-btn.active,
        body.theme-cyber .dropdown-btn.active {
            background: #FF5FA2 !important;
            color: #FFFFFF !important;
            border-color: #FF5FA2 !important;
            box-shadow: 0 0 15px rgba(255, 95, 162, 0.5) !important;
        }

        body.theme-cyber .user-info-btn {
            background: rgba(255, 95, 162, 0.1);
            border-color: rgba(255, 95, 162, 0.2);
            color: #FF9BD4;
        }

        body.theme-cyber .user-name {
            color: #FF9BD4;
        }

        body.theme-cyber .user-role {
            color: rgba(255, 157, 212, 0.7);
        }

        body.theme-cyber .logout-btn {
            background: rgba(255, 75, 75, 0.15) !important;
            color: #FF6B6B !important;
            border-color: rgba(255, 75, 75, 0.3) !important;
        }

        body.theme-cyber .logout-btn:hover {
            background: rgba(255, 75, 75, 0.25) !important;
        }

        body.theme-cyber .dropdown-menu {
            background: rgba(28, 20, 51, 0.95);
            border-color: rgba(255, 95, 162, 0.4);
        }

        body.theme-cyber .dropdown-item {
            color: #FFFFFF;
            background: rgba(28, 20, 51, 0.95);
        }

        body.theme-cyber .dropdown-item:hover {
            background: rgba(255, 95, 162, 0.15);
            color: #FF9BD4;
        }

        body.theme-cyber .dropdown-item.active {
            background: rgba(255, 95, 162, 0.25);
            color: #FF9BD4;
            border-left-color: #FF9BD4;
        }
    `;

    document.head.appendChild(style);
}

/**
 * Generate a cute SVG avatar based on user role
 * Returns an inline SVG element with role-specific styling
 */
/**
 * Populate user info in the top-right corner
 */
function populateUserInfo(user) {
    const topNavRight = document.querySelector('.top-nav-right');
    if (!topNavRight) return;

    topNavRight.innerHTML = '';

    // Create user dropdown container
    const userDropdownContainer = document.createElement('div');
    userDropdownContainer.className = 'user-dropdown-container';

    // Create clickable user info button
    const userBtn = document.createElement('button');
    userBtn.className = 'nav-btn user-dropdown-btn';
    userBtn.innerHTML = `
        <i class="fas fa-user-circle"></i>
        <span class="user-name">${user.displayName || user.name}</span>
        <i class="fas fa-chevron-down user-dropdown-arrow"></i>
    `;
    userBtn.title = `${user.displayName || user.name} (${user.role})`;
    
    // Create dropdown menu
    const userDropdownMenu = document.createElement('div');
    userDropdownMenu.className = 'user-dropdown-menu';
    
    // Add dropdown menu items
    const menuItems = [
        {
            icon: 'user-edit',
            label: 'Edit Profile',
            action: () => openEditProfileModal(user)
        },
        {
            icon: 'key',
            label: 'Change Password',
            action: () => openChangePasswordModal(user)
        },
        {
            icon: 'shield-alt',
            label: 'Two-Factor Auth',
            action: () => openTwoFactorModal(user)
        },
        {
            icon: 'cog',
            label: 'User Settings',
            action: () => openUserSettingsModal(user)
        },
        {
            icon: 'sign-out-alt',
            label: 'Logout',
            action: () => window.Auth.logout(),
            className: 'logout-item'
        }
    ];

    menuItems.forEach(item => {
        const menuItem = document.createElement('a');
        menuItem.className = `user-dropdown-item ${item.className || ''}`;
        menuItem.href = '#';
        menuItem.innerHTML = `<i class="fas fa-${item.icon}"></i> ${item.label}`;
        menuItem.title = item.label;
        menuItem.onclick = (e) => {
            e.preventDefault();
            userDropdownMenu.classList.remove('show');
            item.action();
        };
        userDropdownMenu.appendChild(menuItem);
    });
    
    // Toggle dropdown on button click
    userBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        userDropdownMenu.classList.toggle('show');
    };
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!userDropdownContainer.contains(e.target)) {
            userDropdownMenu.classList.remove('show');
        }
    });
    
    // Append elements
    userDropdownContainer.appendChild(userBtn);
    userDropdownContainer.appendChild(userDropdownMenu);
    topNavRight.appendChild(userDropdownContainer);

    // Update navigation using nav.js system
    if (window.Navigation && window.Navigation.buildNav) {
        window.Navigation.buildNav(user);
    }
}

/**
 * Auto-initialize on DOM ready
 */
document.addEventListener('DOMContentLoaded', initializePage);

/**
 * Profile Management Functions
 */

// Create modal container if it doesn't exist
function ensureModalContainer() {
    let modalContainer = document.getElementById('profile-modals');
    if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'profile-modals';
        modalContainer.style.colorScheme = getComputedStyle(document.body).colorScheme;
        document.body.appendChild(modalContainer);
    }
    return modalContainer;
}

// Open Edit Profile Modal
function openEditProfileModal(user) {
    const modalContainer = ensureModalContainer();
    
    const modalHTML = `
        <div id="edit-profile-modal" class="profile-modal">
            <div class="profile-modal-content">
                <div class="profile-modal-header">
                    <h2 class="profile-modal-title"><i class="fas fa-user-edit"></i> Edit Profile</h2>
                    <button class="profile-modal-close" id="close-edit-profile-btn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="profile-avatar-section">
                    <div class="profile-avatar-preview">
                        ${getAvatarSVG(user.role)}
                    </div>
                    <div class="profile-avatar-info">
                        Role-based avatar: ${formatRole(user.role)}
                    </div>
                </div>
                
                <form id="edit-profile-form">
                    <div class="profile-form-group">
                        <label for="profile-name">Full Name</label>
                        <input type="text" id="profile-name" value="${user.name}" required>
                    </div>
                    
                    <div class="profile-form-group">
                        <label for="profile-email">Email Address</label>
                        <input type="email" id="profile-email" value="${user.email}" required>
                    </div>
                    
                    <div class="profile-form-group">
                        <label for="profile-role">Role</label>
                        <select id="profile-role" disabled>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrator</option>
                            <option value="poweruser" ${user.role === 'poweruser' ? 'selected' : ''}>Power User</option>
                            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
                        </select>
                        <small>Role can only be changed by an administrator</small>
                    </div>
                </form>
                
                <div class="profile-form-actions">
                    <button type="button" class="profile-btn profile-btn-secondary" id="cancel-edit-profile-btn">
                        Cancel
                    </button>
                    <button type="button" class="profile-btn profile-btn-primary" id="save-edit-profile-btn">
                        <i class="fas fa-save"></i> Save Changes
                    </button>
                </div>
            </div>
        </div>
    `;
    
    modalContainer.innerHTML = modalHTML;
    const modal = document.getElementById('edit-profile-modal');
    modal.classList.add('show');
    
    // Add event listeners
    document.getElementById('close-edit-profile-btn').addEventListener('click', () => closeModal('edit-profile-modal'));
    document.getElementById('cancel-edit-profile-btn').addEventListener('click', () => closeModal('edit-profile-modal'));
    document.getElementById('save-edit-profile-btn').addEventListener('click', saveProfile);
}

// Open Change Password Modal
function openChangePasswordModal(user) {
    const modalContainer = ensureModalContainer();
    
    const modalHTML = `
        <div id="change-password-modal" class="profile-modal">
            <div class="profile-modal-content">
                <div class="profile-modal-header">
                    <h2 class="profile-modal-title"><i class="fas fa-key"></i> Change Password</h2>
                    <button class="profile-modal-close" id="close-change-password-btn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <form id="change-password-form">
                    <div class="profile-form-group">
                        <label for="current-password">Current Password</label>
                        <input type="password" id="current-password" required>
                    </div>
                    
                    <div class="profile-form-group">
                        <label for="new-password">New Password</label>
                        <input type="password" id="new-password" required>
                    </div>
                    
                    <div class="profile-form-group">
                        <label for="confirm-password">Confirm New Password</label>
                        <input type="password" id="confirm-password" required>
                    </div>
                </form>
                
                <div class="profile-form-actions">
                    <button type="button" class="profile-btn profile-btn-secondary" id="cancel-change-password-btn">
                        Cancel
                    </button>
                    <button type="button" class="profile-btn profile-btn-primary" id="save-change-password-btn">
                        <i class="fas fa-key"></i> Update Password
                    </button>
                </div>
            </div>
        </div>
    `;
    
    modalContainer.innerHTML = modalHTML;
    const modal = document.getElementById('change-password-modal');
    modal.classList.add('show');
    
    // Add event listeners
    document.getElementById('close-change-password-btn').addEventListener('click', () => closeModal('change-password-modal'));
    document.getElementById('cancel-change-password-btn').addEventListener('click', () => closeModal('change-password-modal'));
    document.getElementById('save-change-password-btn').addEventListener('click', changePassword);
}

// Open User Settings Modal
function openUserSettingsModal(user) {
    const modalContainer = ensureModalContainer();
    
    // Get current theme and settings from localStorage
    const currentTheme = localStorage.getItem('theme') || 'default';
    const animations = localStorage.getItem('animations') !== 'false';
    const notifications = localStorage.getItem('notifications') !== 'false';
    const autoSave = localStorage.getItem('autoSave') !== 'false';
    
    const modalHTML = `
        <div id="user-settings-modal" class="profile-modal">
            <div class="profile-modal-content">
                <div class="profile-modal-header">
                    <h2 class="profile-modal-title"><i class="fas fa-cog"></i> User Settings</h2>
                    <button class="profile-modal-close" id="close-user-settings-btn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <form id="user-settings-form">
                    <div class="profile-form-group">
                        <label for="settings-theme">Theme</label>
                        <select id="settings-theme">
                            <option value="default" ${currentTheme === 'default' ? 'selected' : ''}>Default (Anime)</option>
                            <option value="pastel" ${currentTheme === 'pastel' ? 'selected' : ''}>Pastel</option>
                            <option value="cyber" ${currentTheme === 'cyber' ? 'selected' : ''}>Cyber</option>
                            <option value="mocha" ${currentTheme === 'mocha' ? 'selected' : ''}>Mocha</option>
                            <option value="ice" ${currentTheme === 'ice' ? 'selected' : ''}>Ice</option>
                            <option value="nature" ${currentTheme === 'nature' ? 'selected' : ''}>Nature</option>
                            <option value="sunset" ${currentTheme === 'sunset' ? 'selected' : ''}>Sunset</option>
                        </select>
                    </div>
                    
                    <div class="profile-form-group">
                        <label>
                            <input type="checkbox" id="settings-animations" ${animations ? 'checked' : ''}> 
                            Enable Animations
                        </label>
                    </div>
                    
                    <div class="profile-form-group">
                        <label>
                            <input type="checkbox" id="settings-notifications" ${notifications ? 'checked' : ''}> 
                            Enable Notifications
                        </label>
                    </div>
                    
                    <div class="profile-form-group">
                        <label>
                            <input type="checkbox" id="settings-autosave" ${autoSave ? 'checked' : ''}> 
                            Auto-save Settings
                        </label>
                    </div>
                    
                    <div class="profile-form-group">
                        <label for="settings-language">Language</label>
                        <select id="settings-language">
                            <option value="en" selected>English</option>
                            <option value="es" disabled>Spanish (Coming Soon)</option>
                            <option value="fr" disabled>French (Coming Soon)</option>
                        </select>
                    </div>
                </form>
                
                <div class="profile-form-actions">
                    <button type="button" class="profile-btn profile-btn-secondary" id="cancel-user-settings-btn">
                        Cancel
                    </button>
                    <button type="button" class="profile-btn profile-btn-primary" id="save-user-settings-btn">
                        <i class="fas fa-save"></i> Save Settings
                    </button>
                </div>
            </div>
        </div>
    `;
    
    modalContainer.innerHTML = modalHTML;
    const modal = document.getElementById('user-settings-modal');
    modal.classList.add('show');
    
    // Add event listeners
    document.getElementById('close-user-settings-btn').addEventListener('click', () => closeModal('user-settings-modal'));
    document.getElementById('cancel-user-settings-btn').addEventListener('click', () => closeModal('user-settings-modal'));
    document.getElementById('save-user-settings-btn').addEventListener('click', saveUserSettings);
}

// Open Two-Factor Authentication Modal
function openTwoFactorModal(user) {
    const modalContainer = ensureModalContainer();
    
    const modalHTML = `
        <div id="twofa-navbar-modal" class="profile-modal">
            <div class="profile-modal-content">
                <div class="profile-modal-header">
                    <h2 class="profile-modal-title"><i class="fas fa-shield-alt"></i> Two-Factor Authentication</h2>
                    <button class="profile-modal-close" id="close-twofa-btn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div id="twofa-check-status">
                    <p style="text-align: center; padding: 20px; color: #666;">Checking your 2FA status...</p>
                </div>

                <!-- 2FA Not Enabled Section -->
                <div id="twofa-not-enabled" style="display: none;">
                    <h3 style="color: var(--primary); margin-bottom: 15px;">Enable Two-Factor Authentication</h3>
                    <p style="color: #666; margin-bottom: 20px;">Protect your account with a second verification factor using an authenticator app.</p>

                    <div id="twofa-setup-section" style="text-align: center; padding: 20px; background: rgba(0, 224, 255, 0.1); border-radius: 10px; margin-bottom: 20px;">
                        <p style="color: #666; margin-bottom: 15px;">
                            <strong>Step 1:</strong> Scan this QR code with your authenticator app<br>
                            (Google Authenticator, Microsoft Authenticator, Authy, etc.)
                        </p>
                        <div id="twofa-qr-code-navbar" style="margin: 20px 0; padding: 20px; background: white; border-radius: 10px; display: inline-block;"></div>
                        <p style="color: #999; font-size: 0.9rem; margin-top: 15px;">
                            Can't scan? Enter this code manually:<br>
                            <code id="twofa-manual-code-navbar" style="background: #f5f5f5; padding: 8px 12px; border-radius: 5px; display: block; margin-top: 10px; font-family: monospace; font-size: 0.9rem; word-break: break-all; max-width: 100%; white-space: normal;"></code>
                        </p>
                    </div>

                    <div class="profile-form-group">
                        <label for="twofa-verify-code-navbar">Enter 6-digit code from your app:</label>
                        <input type="text" id="twofa-verify-code-navbar" placeholder="000000" maxlength="6" inputmode="numeric" style="text-align: center; font-size: 1.2rem; letter-spacing: 3px; font-family: monospace;">
                    </div>

                    <div id="twofa-backup-codes-display-navbar" style="display: none; background: rgba(255, 107, 107, 0.1); padding: 15px; border-radius: 10px; border-left: 4px solid #ff6b6b; margin-bottom: 15px;">
                        <label>Backup Codes (save these in a safe place):</label>
                        <textarea id="twofa-backup-codes-text-navbar" readonly style="background: white; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 0.9rem; min-height: 80px; margin-top: 10px; width: 100%;"></textarea>
                        <small style="color: #999; display: block; margin-top: 10px;">Each code can be used once if you lose access to your authenticator app</small>
                    </div>

                    <div class="profile-form-actions">
                        <button type="button" class="profile-btn profile-btn-secondary" id="twofa-cancel-btn-navbar">
                            Cancel
                        </button>
                        <button type="button" class="profile-btn profile-btn-primary" id="twofa-verify-btn-navbar">
                            <i class="fas fa-check"></i> Verify 2FA
                        </button>
                        <button type="button" class="profile-btn profile-btn-success" id="twofa-enroll-btn-navbar" style="display: none;" disabled>
                            <i class="fas fa-shield-alt"></i> Enroll 2FA
                        </button>
                    </div>
                </div>

                <!-- 2FA Enabled Section -->
                <div id="twofa-already-enabled-navbar" style="display: none;">
                    <div style="text-align: center; padding: 30px; background: rgba(46, 213, 115, 0.1); border-radius: 10px; border: 2px solid #2ed573; margin-bottom: 20px;">
                        <i class="fas fa-check-circle" style="font-size: 3rem; color: #2ed573; margin-bottom: 15px;"></i>
                        <h3 style="color: #2ed573; margin: 10px 0;">2FA is Enabled</h3>
                        <p style="color: #666; margin: 10px 0;">Your account is protected with two-factor authentication.</p>
                    </div>

                    <div style="margin-top: 20px;">
                        <h4 style="margin-bottom: 15px;">Your Options:</h4>
                        <button type="button" class="profile-btn profile-btn-secondary" id="twofa-view-backup-btn-navbar" style="width: 100%; margin-bottom: 10px;">
                            <i class="fas fa-list"></i> View Backup Codes
                        </button>
                        <button type="button" class="profile-btn profile-btn-danger" id="twofa-disable-btn-navbar" style="width: 100%;">
                            <i class="fas fa-trash"></i> Disable 2FA
                        </button>
                    </div>

                    <div id="twofa-backup-codes-view-navbar" style="display: none; margin-top: 20px; padding: 15px; background: rgba(255, 107, 107, 0.1); border-radius: 10px; border-left: 4px solid #ff6b6b;">
                        <p style="color: #666; margin-bottom: 10px;">Your backup codes:</p>
                        <textarea id="twofa-backup-codes-view-text-navbar" readonly style="background: white; padding: 10px; border-radius: 5px; font-family: monospace; font-size: 0.9rem; width: 100%; min-height: 100px;"></textarea>
                        <small style="color: #999; display: block; margin-top: 10px;">Keep these codes in a safe place. Each can be used once to sign in if you lose your authenticator device.</small>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    modalContainer.innerHTML = modalHTML;
    const modal = document.getElementById('twofa-navbar-modal');
    modal.classList.add('show');
    
    // Check current 2FA status
    checkUserTwoFAStatusNavbar(user);
    
    // Add event listeners
    document.getElementById('close-twofa-btn').addEventListener('click', () => closeModal('twofa-navbar-modal'));
    document.getElementById('twofa-cancel-btn-navbar').addEventListener('click', () => closeModal('twofa-navbar-modal'));
    document.getElementById('twofa-verify-btn-navbar').addEventListener('click', async () => {
        const code = document.getElementById('twofa-verify-code-navbar').value;
        if (!code || code.length !== 6) {
            showProfileMessage('twofa-navbar-modal', 'Please enter a valid 6-digit code', 'error');
            return;
        }
        await verifyTwoFACodeNavbar(code);
    });
    document.getElementById('twofa-enroll-btn-navbar').addEventListener('click', async () => {
        await enrollTwoFANavbar();
    });
    document.getElementById('twofa-disable-btn-navbar').addEventListener('click', async () => {
        if (confirm('Are you sure you want to disable 2FA? Your account will be less secure.')) {
            await disableTwoFANavbar();
        }
    });
    document.getElementById('twofa-view-backup-btn-navbar').addEventListener('click', () => {
        const backupView = document.getElementById('twofa-backup-codes-view-navbar');
        if (backupView) {
            backupView.style.display = backupView.style.display === 'none' ? 'block' : 'none';
        }
    });
}

async function checkUserTwoFAStatusNavbar(user) {
    try {
        const response = await fetch(`/api/users/${user.id}/2fa-status`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.twoFactorEnabled) {
                showTwoFAEnabledNavbar(data);
            } else {
                await setupTwoFANavbar();
            }
        } else {
            await setupTwoFANavbar();
        }
    } catch (error) {
        console.error('Error checking 2FA status:', error);
        await setupTwoFANavbar();
    }
}

async function setupTwoFANavbar() {
    try {
        const checkStatusDiv = document.getElementById('twofa-check-status');
        const notEnabledDiv = document.getElementById('twofa-not-enabled');

        if (checkStatusDiv) checkStatusDiv.style.display = 'none';
        if (notEnabledDiv) notEnabledDiv.style.display = 'block';

        const response = await fetch('/api/2fa/setup', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to request 2FA setup');
        }

        const data = await response.json();
        if (data.qrCode) {
            const qrDiv = document.getElementById('twofa-qr-code-navbar');
            const manualCodeEl = document.getElementById('twofa-manual-code-navbar');

            if (qrDiv) {
                // Create img element for QR code
                qrDiv.innerHTML = `<img src="${data.qrCode}" alt="2FA QR Code" style="max-width: 200px; max-height: 200px;">`;
            }
            if (manualCodeEl) {
                manualCodeEl.textContent = data.secret;
            }

            window.currentTwoFASecret = data.secret;
        }
    } catch (error) {
        console.error('Error setting up 2FA:', error);
        showProfileMessage('twofa-navbar-modal', 'Failed to setup 2FA: ' + error.message, 'error');
        closeModal('twofa-navbar-modal');
    }
}

function showTwoFAEnabledNavbar(data) {
    const checkStatusDiv = document.getElementById('twofa-check-status');
    const enabledDiv = document.getElementById('twofa-already-enabled-navbar');

    if (checkStatusDiv) checkStatusDiv.style.display = 'none';
    if (enabledDiv) enabledDiv.style.display = 'block';

    if (data.backupCodes && data.backupCodes.length > 0) {
        const viewText = document.getElementById('twofa-backup-codes-view-text-navbar');
        if (viewText) {
            viewText.value = data.backupCodes.join('\n');
        }
    }
}

// Store verification state
let pendingTwoFASecret = null;
let pendingBackupCodes = null;

async function verifyTwoFACodeNavbar(code) {
    try {
        showProfileMessage('twofa-navbar-modal', 'Verifying code...', 'info');
        
        const response = await fetch('/api/2fa/verify-setup', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                code: code,
                secret: window.currentTwoFASecret
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Verification failed');
        }

        const data = await response.json();
        
        // Store the secret and backup codes for enrollment
        pendingTwoFASecret = window.currentTwoFASecret;
        pendingBackupCodes = data.backupCodes;
        
        showProfileMessage('twofa-navbar-modal', 'Code verified successfully! Review your backup codes and click "Enroll 2FA" to save.', 'success');
        
        // Show backup codes
        if (data.backupCodes) {
            const backupDisplay = document.getElementById('twofa-backup-codes-display-navbar');
            const backupText = document.getElementById('twofa-backup-codes-text-navbar');
            if (backupDisplay && backupText) {
                backupText.value = data.backupCodes.join('\n');
                backupDisplay.style.display = 'block';
            }
        }
        
        // Update Verify button to show checkmark and grey out
        const verifyBtn = document.getElementById('twofa-verify-btn-navbar');
        verifyBtn.innerHTML = '✓ Verified';
        verifyBtn.disabled = true;
        verifyBtn.style.backgroundColor = '#6c757d';
        verifyBtn.style.borderColor = '#6c757d';
        verifyBtn.style.cursor = 'not-allowed';
        
        // Enable and highlight the Enroll button
        const enrollBtn = document.getElementById('twofa-enroll-btn-navbar');
        enrollBtn.style.display = 'inline-block';
        enrollBtn.disabled = false;
        enrollBtn.style.backgroundColor = '#28a745';
        enrollBtn.style.borderColor = '#28a745';
        
        // Add pulse animation CSS if not already added
        if (!document.getElementById('twofa-pulse-animation')) {
            const style = document.createElement('style');
            style.id = 'twofa-pulse-animation';
            style.textContent = `
                @keyframes twofa-pulse {
                    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.7); }
                    50% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(40, 167, 69, 0); }
                    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(40, 167, 69, 0); }
                }
            `;
            document.head.appendChild(style);
        }
        enrollBtn.style.animation = 'twofa-pulse 2s infinite';
        
    } catch (error) {
        console.error('Error verifying 2FA:', error);
        showProfileMessage('twofa-navbar-modal', 'Failed to verify code: ' + error.message, 'error');
    }
}

async function enrollTwoFANavbar() {
    if (!pendingTwoFASecret || !pendingBackupCodes) {
        showProfileMessage('twofa-navbar-modal', 'Please verify your code first', 'error');
        return;
    }

    try {
        showProfileMessage('twofa-navbar-modal', 'Enrolling 2FA...', 'info');
        
        const token = localStorage.getItem('authToken');
        
        // Save 2FA settings using the settings API
        const requests = [
            fetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    key: 'twofa_enabled',
                    value: 'true',
                    category: 'security'
                })
            }),
            fetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    key: 'twofa_secret',
                    value: pendingTwoFASecret,
                    category: 'security'
                })
            }),
            fetch('/api/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    key: 'backup_codes',
                    value: pendingBackupCodes.join(','),
                    category: 'security'
                })
            })
        ];

        const responses = await Promise.all(requests);
        const allSuccessful = responses.every(response => response.ok);
        
        if (allSuccessful) {
            showProfileMessage('twofa-navbar-modal', '2FA has been successfully enrolled!', 'success');
            
            // Clear pending data
            pendingTwoFASecret = null;
            pendingBackupCodes = null;
            
            // Close modal after a brief delay
            setTimeout(() => {
                closeModal('twofa-navbar-modal');
            }, 2000);
        } else {
            throw new Error('Failed to save all 2FA settings');
        }
    } catch (error) {
        console.error('Error enrolling 2FA:', error);
        showProfileMessage('twofa-navbar-modal', 'Error enrolling 2FA: ' + error.message, 'error');
    }
}

async function verifyAndEnableTwoFANavbar(code) {
    // This function is now deprecated - use verifyTwoFACodeNavbar instead
    // Kept for compatibility
    await verifyTwoFACodeNavbar(code);
}

async function disableTwoFANavbar() {
    try {
        const response = await fetch('/api/2fa/disable', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to disable 2FA');
        }

        showProfileMessage('twofa-navbar-modal', '2FA has been disabled', 'success');
        closeModal('twofa-navbar-modal');
    } catch (error) {
        console.error('Error disabling 2FA:', error);
        showProfileMessage('twofa-navbar-modal', 'Failed to disable 2FA: ' + error.message, 'error');
    }
}

// Close modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            const container = document.getElementById('profile-modals');
            if (container) {
                container.innerHTML = '';
            }
        }, 300);
    }
}

// Save profile changes
async function saveProfile() {
    const name = document.getElementById('profile-name').value.trim();
    const email = document.getElementById('profile-email').value.trim();
    
    if (!name || !email) {
        showProfileMessage('edit-profile-modal', 'Please fill in all required fields.', 'error');
        return;
    }
    
    try {
        const user = window.Auth.getCurrentUser();
        const response = await fetch(`/api/users/${user.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({
                name: name,
                email: email
            })
        });
        
        if (response.ok) {
            // Update local user data
            const updatedUser = { ...user, name, email };
            localStorage.setItem('user', JSON.stringify(updatedUser));
            
            showProfileMessage('edit-profile-modal', 'Profile updated successfully!', 'success');
            
            // Refresh the page to update all user displays
            setTimeout(() => {
                closeModal('edit-profile-modal');
                location.reload();
            }, 1500);
        } else {
            const error = await response.json();
            showProfileMessage('edit-profile-modal', error.error || 'Failed to update profile.', 'error');
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        showProfileMessage('edit-profile-modal', 'An error occurred while updating your profile.', 'error');
    }
}

// Change password
async function changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (!currentPassword || !newPassword || !confirmPassword) {
        showProfileMessage('change-password-modal', 'Please fill in all fields.', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showProfileMessage('change-password-modal', 'New passwords do not match.', 'error');
        return;
    }
    
    if (newPassword.length < 6) {
        showProfileMessage('change-password-modal', 'New password must be at least 6 characters long.', 'error');
        return;
    }
    
    try {
        const user = window.Auth.getCurrentUser();
        const response = await fetch(`/api/users/${user.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({
                password: newPassword
            })
        });
        
        if (response.ok) {
            showProfileMessage('change-password-modal', 'Password updated successfully!', 'success');
            
            setTimeout(() => {
                closeModal('change-password-modal');
            }, 1500);
        } else {
            const error = await response.json();
            showProfileMessage('change-password-modal', error.error || 'Failed to change password.', 'error');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        showProfileMessage('change-password-modal', 'An error occurred while changing your password.', 'error');
    }
}

// Save user settings
function saveUserSettings() {
    const theme = document.getElementById('settings-theme').value;
    const animations = document.getElementById('settings-animations').checked;
    const notifications = document.getElementById('settings-notifications').checked;
    const autoSave = document.getElementById('settings-autosave').checked;
    
    // Apply settings through ThemeManager if available
    if (window.ThemeManager) {
        window.ThemeManager.setTheme(theme);
        window.ThemeManager.toggleAnimations(animations);
    } else {
        // Fallback for when ThemeManager isn't available
        localStorage.setItem('theme', theme);
        localStorage.setItem('animations', animations.toString());
        
        // Apply animation setting
        if (animations) {
            document.body.classList.add('animations-enabled');
        } else {
            document.body.classList.remove('animations-enabled');
        }
    }
    
    // Save other non-theme settings to localStorage
    localStorage.setItem('notifications', notifications.toString());
    localStorage.setItem('autoSave', autoSave.toString());
    
    showProfileMessage('user-settings-modal', 'Settings saved successfully!', 'success');
    
    setTimeout(() => {
        closeModal('user-settings-modal');
    }, 1500);
}

// Show message in modal
function showProfileMessage(modalId, message, type) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    // Remove existing messages
    const existingMessages = modal.querySelectorAll('.profile-success-message, .profile-error-message');
    existingMessages.forEach(msg => msg.remove());
    
    // Create new message
    const messageDiv = document.createElement('div');
    messageDiv.className = `profile-${type}-message`;
    messageDiv.textContent = message;
    
    // Insert at the top of the form
    const form = modal.querySelector('form');
    if (form && form.parentNode) {
        form.parentNode.insertBefore(messageDiv, form);
    }
}

// Format role for display
function formatRole(role) {
    const roleMap = {
        'admin': 'Administrator',
        'poweruser': 'Power User', 
        'user': 'User'
    };
    return roleMap[role] || role;
}

// Make functions globally available
window.ProfileManager = {
    openEditProfileModal,
    openChangePasswordModal, 
    openUserSettingsModal,
    closeModal,
    saveProfile,
    changePassword,
    saveUserSettings
};
