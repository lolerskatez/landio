/**
 * Navigation and Access Control System
 * Manages role-based access and dynamic navigation for all pages
 */

// Define page access control by role (only once)
if (!window.PAGE_ACCESS) {
    window.PAGE_ACCESS = {
        'index.html': ['admin', 'poweruser', 'user'],           // Admin Dashboard
        'dashboard.html': ['admin', 'poweruser', 'user'],       // User Dashboard
        'settings.html': ['admin'],                             // Admin Settings
        'manage-services.html': ['admin', 'poweruser'],         // Manage Services
        'logs.html': ['admin'],                                 // System Logs
        'login.html': ['all'],                                  // Login (public)
    };

    // Navigation menu structure by role
    window.NAVIGATION_MENU = {
        admin: [
            { label: 'Dashboard', icon: 'home', href: 'index.html', page: 'dashboard', section: 'main' },
            { label: 'Administrator', icon: 'shield-alt', href: '#', section: 'admin', isDropdown: true },
        ],
        poweruser: [
            { label: 'Dashboard', icon: 'home', href: 'dashboard.html', page: 'dashboard', section: 'main' },
            { label: 'Management', icon: 'star', href: '#', section: 'poweruser', isDropdown: true },
        ],
        user: [
            { label: 'Dashboard', icon: 'home', href: 'dashboard.html', page: 'dashboard', section: 'main' },
        ]
    };

    // Administrator submenu items (only visible to admin users)
    window.ADMIN_SUBMENU = [
        { label: 'Settings', icon: 'cog', href: 'settings.html', page: 'settings' },
        { label: 'Manage Services', icon: 'cube', href: 'manage-services.html', page: 'manage-services' },
        { label: 'Logs', icon: 'list-alt', href: 'logs.html', page: 'logs' },
    ];
    
    // Power User submenu items
    window.POWERUSER_SUBMENU = [
        { label: 'Manage Services', icon: 'cube', href: 'manage-services.html', page: 'manage-services' },
    ];
}

// Navigation functions (can run multiple times)

/**
 * Initialize navigation on page load
 * Checks authentication and builds appropriate navigation
 */
function initializeNavigation() {
    const user = window.Auth?.getCurrentUser?.();
    
    if (!user) {
        // Not logged in - redirect to login
        if (window.location.pathname !== '/login.html' && !window.location.href.includes('login.html')) {
            window.location.href = 'login.html';
        }
        return;
    }

    // Check page access
    checkPageAccess(user);

    // Build navigation
    buildNavigation(user);
}

/**
 * Check if current user has access to current page
 * Redirects to appropriate dashboard if unauthorized
 */
function checkPageAccess(user) {
    const currentPage = getCurrentPage();
    const userRole = user.role;
    
    // Get allowed roles for this page
    const allowedRoles = window.PAGE_ACCESS[currentPage] || [];

    // Check if user has access
    if (!allowedRoles.includes(userRole)) {
        console.warn(`Access denied: ${userRole} cannot access ${currentPage}`);
        
        // Redirect to appropriate dashboard
        if (userRole === 'admin') {
            window.location.href = 'index.html';
        } else if (userRole === 'poweruser') {
            window.location.href = 'dashboard.html';
        } else {
            window.location.href = 'dashboard.html';
        }
    }
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
 * Build navigation menu based on user role
 */
function buildNavigation(user) {
    // Try to find the nav container - could be #main-nav or inside #nav-container
    let navContainer = document.getElementById('main-nav');
    if (!navContainer) {
        const parentNav = document.getElementById('nav-container');
        if (parentNav) {
            navContainer = parentNav.querySelector('[id="main-nav"]');
        }
    }
    
    if (!navContainer) {
        // Container not ready yet, try again in a moment
        setTimeout(() => buildNavigation(user), 100);
        return;
    }

    // Clear existing navigation
    navContainer.innerHTML = '';

    // Get menu items for this role
    const menuItems = window.NAVIGATION_MENU[user.role] || [];

    // Build navigation buttons
    menuItems.forEach(item => {
        if (item.isDropdown) {
            // Create dropdown menu for Administrator/PowerUser
            if (user.role === 'admin') {
                createAdminDropdown(navContainer, user);
            } else if (user.role === 'poweruser') {
                createPoweruserDropdown(navContainer, user);
            }
        } else {
            // Create regular button
            const btn = document.createElement('button');
            btn.className = 'nav-btn';
            
            // Mark current page as active - only Dashboard button on dashboard/main pages
            const shouldBeActive = isCurrentPage(item.href);
            console.log(`Nav button ${item.label}: href=${item.href}, currentPage=${getCurrentPage()}, isActive=${shouldBeActive}`);
            
            if (shouldBeActive) {
                btn.classList.add('active');
            }
            
            btn.onclick = (e) => {
                e.preventDefault();
                window.location.href = item.href;
            };
            
            btn.innerHTML = `<i class="fas fa-${item.icon}"></i> ${item.label}`;
            btn.title = `Go to ${item.label}`;
            
            navContainer.appendChild(btn);
        }
    });

    // User info and logout buttons are handled by loadUserInfo() in index.html
    // Don't add them here to avoid duplication
}

/**
 * Create Administrator dropdown menu
 */
function createAdminDropdown(navContainer, user) {
    // Create dropdown container
    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'nav-dropdown';
    
    // Create dropdown button
    const dropdownBtn = document.createElement('button');
    dropdownBtn.className = 'nav-btn dropdown-btn';
    dropdownBtn.innerHTML = '<i class="fas fa-shield-alt"></i> Administrator <i class="fas fa-chevron-down" style="font-size: 0.75rem; margin-left: 5px;"></i>';
    dropdownBtn.title = 'Administrator Tools';
    
    // Create dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'dropdown-menu';
    
    // Add submenu items
    window.ADMIN_SUBMENU.forEach(item => {
        const menuItem = document.createElement('a');
        menuItem.className = 'dropdown-item';
        menuItem.href = '#';
        
        // Mark current page as active
        if (isCurrentPage(item.href)) {
            menuItem.classList.add('active');
            dropdownBtn.classList.add('active');
        }
        
        menuItem.onclick = (e) => {
            e.preventDefault();
            window.location.href = item.href;
        };
        
        menuItem.innerHTML = `<i class="fas fa-${item.icon}"></i> ${item.label}`;
        menuItem.title = `Go to ${item.label}`;
        
        dropdownMenu.appendChild(menuItem);
    });
    
    // Toggle dropdown on button click
    dropdownBtn.onclick = (e) => {
        e.preventDefault();
        dropdownMenu.classList.toggle('show');
    };
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdownContainer.contains(e.target)) {
            dropdownMenu.classList.remove('show');
        }
    });
    
    // Append menu to container
    dropdownContainer.appendChild(dropdownBtn);
    dropdownContainer.appendChild(dropdownMenu);
    
    // Add to navigation
    navContainer.appendChild(dropdownContainer);
}

/**
 * Create Power User dropdown menu
 */
function createPoweruserDropdown(navContainer, user) {
    // Create dropdown container
    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'nav-dropdown';
    
    // Create dropdown button
    const dropdownBtn = document.createElement('button');
    dropdownBtn.className = 'nav-btn dropdown-btn';
    dropdownBtn.innerHTML = '<i class="fas fa-star"></i> Management <i class="fas fa-chevron-down" style="font-size: 0.75rem; margin-left: 5px;"></i>';
    dropdownBtn.title = 'Management Tools';
    
    // Create dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'dropdown-menu';
    
    // Add submenu items
    window.POWERUSER_SUBMENU.forEach(item => {
        const menuItem = document.createElement('a');
        menuItem.className = 'dropdown-item';
        menuItem.href = '#';
        
        // Mark current page as active
        if (isCurrentPage(item.href)) {
            menuItem.classList.add('active');
            dropdownBtn.classList.add('active');
        }
        
        menuItem.onclick = (e) => {
            e.preventDefault();
            window.location.href = item.href;
        };
        
        menuItem.innerHTML = `<i class="fas fa-${item.icon}"></i> ${item.label}`;
        menuItem.title = `Go to ${item.label}`;
        
        dropdownMenu.appendChild(menuItem);
    });
    
    // Toggle dropdown on button click
    dropdownBtn.onclick = (e) => {
        e.preventDefault();
        dropdownMenu.classList.toggle('show');
    };
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdownContainer.contains(e.target)) {
            dropdownMenu.classList.remove('show');
        }
    });
    
    // Append menu to container
    dropdownContainer.appendChild(dropdownBtn);
    dropdownContainer.appendChild(dropdownMenu);
    
    // Add to navigation
    navContainer.appendChild(dropdownContainer);
}

/**
 * Add user info button to navigation
 */
function addUserInfoButton(navContainer, user) {
    const userBtn = document.createElement('button');
    userBtn.className = 'nav-btn user-info-btn';
    userBtn.innerHTML = `
        <i class="fas fa-user-circle"></i> 
        <span class="user-name">${user.name}</span>
        <span class="user-role">${formatRole(user.role)}</span>
    `;
    userBtn.title = `Logged in as ${user.name} (${user.role})`;
    userBtn.style.opacity = '0.7';
    userBtn.style.cursor = 'default';
    userBtn.disabled = true;
    
    navContainer.appendChild(userBtn);
}

/**
 * Add logout button to navigation
 */
function addLogoutButton(navContainer) {
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'nav-btn logout-btn';
    logoutBtn.onclick = () => {
        if (window.Auth?.logout) {
            window.Auth.logout();
        } else {
            console.error('Logout function not available');
            window.location.href = 'login.html';
        }
    };
    logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
    logoutBtn.title = 'Sign out and return to login';
    
    navContainer.appendChild(logoutBtn);
}

/**
 * Check if href is current page
 */
function isCurrentPage(href) {
    const currentPage = getCurrentPage();
    const hrefPage = href.split('/').pop(); // Get just the filename if href is a path
    // Exact match for filename
    return currentPage === hrefPage;
}

/**
 * Format role name for display
 */
function formatRole(role) {
    const roleMap = {
        'admin': 'Administrator',
        'poweruser': 'Power User',
        'user': 'User'
    };
    return roleMap[role] || role;
}

/**
 * Check if user has permission for specific action
 */
function hasPermission(permission) {
    const user = window.Auth?.getCurrentUser?.();
    if (!user) return false;

    return window.Auth?.hasPermission?.(permission) || false;
}

/**
 * Require specific role for page access
 * Call this at the top of protected pages
 */
function requireRole(requiredRoles) {
    const user = window.Auth?.getCurrentUser?.();
    
    if (!user) {
        window.location.href = 'login.html';
        return null;
    }

    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    
    if (!roles.includes(user.role)) {
        console.error(`Access denied: ${user.role} role cannot access this page`);
        
        // Redirect based on role
        if (user.role === 'admin') {
            window.location.href = 'index.html';
        } else if (user.role === 'poweruser') {
            window.location.href = 'dashboard.html';
        } else {
            window.location.href = 'dashboard.html';
        }
        return null;
    }

    return user;
}

/**
 * Require admin role
 */
function requireAdmin() {
    return requireRole(['admin']);
}

/**
 * Require admin or power user
 */
function requirePowerUserOrAdmin() {
    return requireRole(['admin', 'poweruser']);
}

/**
 * Require authentication (any logged-in user)
 */
function requireAuth() {
    const user = window.Auth?.getCurrentUser?.();
    
    if (!user) {
        window.location.href = 'login.html';
        return null;
    }

    return user;
}

/**
 * Hide navigation element based on role
 */
function hideFromRole(role) {
    const element = this;
    const user = window.Auth?.getCurrentUser?.();
    
    if (user && user.role === role) {
        element.style.display = 'none';
    }
}

/**
 * Show navigation element based on role
 */
function showOnlyForRole(requiredRole) {
    const element = this;
    const user = window.Auth?.getCurrentUser?.();
    
    if (!user || user.role !== requiredRole) {
        element.style.display = 'none';
    }
}

// Navigation is initialized by base.js after nav container is injected
// No need for DOMContentLoaded listener here

// Make functions globally available
window.Navigation = {
    initialize: initializeNavigation,
    checkAccess: checkPageAccess,
    buildNav: buildNavigation,
    hasPermission: hasPermission,
    requireRole: requireRole,
    requireAdmin: requireAdmin,
    requirePowerUserOrAdmin: requirePowerUserOrAdmin,
    requireAuth: requireAuth,
    formatRole: formatRole,
    getCurrentPage: getCurrentPage,
    PAGE_ACCESS: window.PAGE_ACCESS,
    NAVIGATION_MENU: window.NAVIGATION_MENU
};

