// Authentication utilities for the Server Dashboard
// This file contains shared authentication functions used across all pages

// Guard against double-loading
if (window.AUTH_LOADED) {
    // Already loaded, skip
} else {
    window.AUTH_LOADED = true;

// User role definitions with permissions
const USER_ROLES = {
    USER: 'user',           // Basic user - can view services, basic monitoring
    POWER_USER: 'poweruser', // Power user - can manage own services, advanced monitoring
    ADMIN: 'admin'          // Administrator - full system access, user management
};

// Role permissions mapping
const ROLE_PERMISSIONS = {
    [USER_ROLES.USER]: {
        canViewServices: true,
        canManageOwnServices: false,
        canManageUsers: false,
        canAccessSettings: false,
        canViewLogs: false,
        canManageSystem: false,
        canManageDocker: false
    },
    [USER_ROLES.POWER_USER]: {
        canViewServices: true,
        canManageOwnServices: true,
        canManageUsers: false,
        canAccessSettings: true,
        canViewLogs: true,
        canManageSystem: false,
        canManageDocker: true
    },
    [USER_ROLES.ADMIN]: {
        canViewServices: true,
        canManageOwnServices: true,
        canManageUsers: true,
        canAccessSettings: true,
        canViewLogs: true,
        canManageSystem: true,
        canManageDocker: true
    }
};
// Authentication utility functions
function setCurrentUser(user) {
    // Ensure user has proper role structure
    const enhancedUser = {
        ...user,
        role: user.role || USER_ROLES.USER,
        permissions: ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS[USER_ROLES.USER],
        lastLogin: new Date().toISOString(),
        sessionStart: new Date().toISOString()
    };

    localStorage.setItem('currentUser', JSON.stringify(enhancedUser));
}

function getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

function logout() {
    const user = getCurrentUser();
    if (user) {
        // Call backend logout endpoint to send notification
        window.Api.logout().catch(err => {
            console.error('Backend logout failed:', err);
        });
    }

    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    
    // Check if user logged in via SSO
    if (user && user.ssoProvider) {
        // Perform SSO logout by redirecting to backend SSO logout endpoint
        window.location.href = '/api/sso/logout';
    } else {
        // Regular local logout
        window.location.href = 'login.html';
    }
}

function requireAuth() {
    const user = getCurrentUser();
    if (!user) {
        window.location.href = 'login.html';
        return null;
    }
    return user;
}

function requireRole(requiredRole) {
    const user = requireAuth();
    if (!user) return null;

    const roleHierarchy = {
        [USER_ROLES.USER]: 1,
        [USER_ROLES.POWER_USER]: 2,
        [USER_ROLES.ADMIN]: 3
    };

    if (roleHierarchy[user.role] < roleHierarchy[requiredRole]) {
        alert(`Access denied. ${requiredRole} role required.`);
        window.location.href = 'index.html';
        return null;
    }
    return user;
}

function requireAdmin() {
    return requireRole(USER_ROLES.ADMIN);
}

function requirePowerUser() {
    return requireRole(USER_ROLES.POWER_USER);
}

// Make auth functions globally available
const hasPermission = (permission) => {
    const user = getCurrentUser();
    if (!user) return false;

    const userPermissions = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS['user'];
    return userPermissions[permission] === true;
};

window.Auth = {
    // User management
    getCurrentUser,
    setCurrentUser,
    logout,
    requireAuth,
    requireRole,
    requireAdmin,
    requirePowerUser,
    hasPermission,

    // Constants
    ROLES: USER_ROLES,
    PERMISSIONS: ROLE_PERMISSIONS,
};

} // End of AUTH_LOADED guard