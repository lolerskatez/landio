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
        canManageSystem: false
    },
    [USER_ROLES.POWER_USER]: {
        canViewServices: true,
        canManageOwnServices: true,
        canManageUsers: false,
        canAccessSettings: true,
        canViewLogs: true,
        canManageSystem: false
    },
    [USER_ROLES.ADMIN]: {
        canViewServices: true,
        canManageOwnServices: true,
        canManageUsers: true,
        canAccessSettings: true,
        canViewLogs: true,
        canManageSystem: true
    }
};

// Authentik SSO configuration - replace with your actual values
const AUTH_CONFIG = {
    // Authentik SSO configuration - replace with your actual values
    authentik: {
        baseUrl: 'https://authentik.example.com', // Replace with your Authentik URL
        clientId: 'your-client-id', // Replace with your client ID
        clientSecret: 'your-client-secret', // Replace with your client secret
        redirectUri: window.location.origin + '/login.html',
        scope: 'openid profile email groups',
        responseType: 'code',
        grantType: 'authorization_code'
    },
    // No demo users - system starts with OOBE (Out-of-Box Experience)
    // First admin user must be created during setup phase
    demoUsers: {}
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
    localStorage.setItem('authToken', 'demo-token-' + Date.now()); // In production, use real tokens

    // Update user in database
    updateUserInDatabase(enhancedUser);
}

function getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

function logout() {
    const user = getCurrentUser();
    if (user) {
        // Track logout activity
        trackUserActivity(user, 'logout');
        
        // Call backend logout endpoint to send notification
        window.Api.logout().catch(err => {
            console.error('Backend logout failed:', err);
        });
    }

    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    localStorage.removeItem('authentik_tokens'); // Clear Authentik tokens
    window.location.href = 'login.html';
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

// User preferences functions
function getUserPreferences() {
    const prefs = localStorage.getItem('userPreferences');
    return prefs ? JSON.parse(prefs) : {
        notifications: 'email',
        theme: 'light',
        layout: 'cards',
        language: 'en'
    };
}

function saveUserPreferences(preferences) {
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
}

// Authentik SSO functions
function initiateAuthentikLogin() {
    const config = AUTH_CONFIG.authentik;
    const authUrl = new URL(`${config.baseUrl}/application/o/authorize/`);

    const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: config.responseType,
        scope: config.scope,
        state: 'dashboard-login-' + Date.now()
    });

    // Store state for validation
    localStorage.setItem('authentik_state', params.get('state'));

    window.location.href = authUrl.toString() + '?' + params.toString();
}

function handleAuthentikCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const storedState = localStorage.getItem('authentik_state');

    if (!code || state !== storedState) {
        alert('Authentication failed - invalid response');
        window.location.href = 'login.html';
        return;
    }

    // Exchange code for tokens
    exchangeAuthentikCode(code);
}

async function exchangeAuthentikCode(code) {
    const config = AUTH_CONFIG.authentik;
    const tokenUrl = `${config.baseUrl}/application/o/token/`;

    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: config.grantType,
                code: code,
                redirect_uri: config.redirectUri,
                client_id: config.clientId,
                client_secret: config.clientSecret,
            }),
        });

        if (!response.ok) {
            throw new Error('Token exchange failed');
        }

        const tokens = await response.json();
        localStorage.setItem('authentik_tokens', JSON.stringify(tokens));

        // Get user info
        await fetchAuthentikUserInfo(tokens.access_token);

    } catch (error) {
        console.error('Authentik token exchange failed:', error);
        alert('Authentication failed');
        window.location.href = 'login.html';
    }
}

async function fetchAuthentikUserInfo(accessToken) {
    const config = AUTH_CONFIG.authentik;
    const userInfoUrl = `${config.baseUrl}/application/o/userinfo/`;

    try {
        const response = await fetch(userInfoUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error('Failed to fetch user info');
        }

        const userInfo = await response.json();

        // Create or update user in our system
        const user = {
            id: userInfo.sub,
            name: userInfo.name || userInfo.preferred_username,
            email: userInfo.email,
            role: USER_ROLES.USER, // Default role, can be enhanced based on groups
            avatar: (userInfo.name || userInfo.preferred_username).split(' ').map(n => n[0]).join('').toUpperCase(),
            groups: userInfo.groups || [],
            lastLogin: new Date().toISOString(),
            isActive: true
        };

        // Check if user exists, update or create
        const existingUser = getUserByEmail(user.email);
        if (existingUser) {
            legacyUpdateUser(existingUser.id, user);
        } else {
            createUser(user);
        }

        setCurrentUser(user);
        window.location.href = 'index.html';

    } catch (error) {
        console.error('Failed to fetch Authentik user info:', error);
        alert('Authentication failed');
        window.location.href = 'login.html';
    }
}

function refreshAuthentikToken() {
    const tokens = JSON.parse(localStorage.getItem('authentik_tokens') || '{}');
    if (!tokens.refresh_token) return;

    const config = AUTH_CONFIG.authentik;
    const tokenUrl = `${config.baseUrl}/application/o/token/`;

    fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: config.clientId,
            client_secret: config.clientSecret,
        }),
    })
    .then(response => response.json())
    .then(newTokens => {
        localStorage.setItem('authentik_tokens', JSON.stringify(newTokens));
    })
    .catch(error => {
        console.error('Token refresh failed:', error);
        logout();
    });
}

// User database functions
function getUserDatabase() {
    const users = localStorage.getItem('users');
    if (!users) {
        // Initialize with demo users
        const initialUsers = Object.values(AUTH_CONFIG.demoUsers);
        localStorage.setItem('users', JSON.stringify(initialUsers));
        return initialUsers;
    }
    return JSON.parse(users);
}

function saveUserDatabase(users) {
    localStorage.setItem('users', JSON.stringify(users));
}

function getUserById(userId) {
    const users = getUserDatabase();
    return users.find(user => user.id === userId);
}

function getUserByEmail(email) {
    const users = getUserDatabase();
    return users.find(user => user.email === email);
}

function createUser(userData) {
    const users = getUserDatabase();

    // Check if user already exists
    if (getUserByEmail(userData.email)) {
        throw new Error('User with this email already exists');
    }

    const newUser = {
        id: Date.now().toString(),
        name: userData.name,
        email: userData.email,
        role: userData.role || USER_ROLES.USER,
        avatar: userData.name.split(' ').map(n => n[0]).join('').toUpperCase(),
        groups: userData.groups || ['users'],
        lastLogin: null,
        createdAt: new Date().toISOString(),
        isActive: userData.isActive !== undefined ? userData.isActive : true,
        permissions: ROLE_PERMISSIONS[userData.role] || ROLE_PERMISSIONS[USER_ROLES.USER]
    };

    users.push(newUser);
    saveUserDatabase(users);

    return newUser;
}

function legacyUpdateUser(userId, updates) {
    const users = getUserDatabase();
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
        throw new Error('User not found');
    }

    // Update permissions if role changed
    if (updates.role && updates.role !== users[userIndex].role) {
        updates.permissions = ROLE_PERMISSIONS[updates.role];
    }

    users[userIndex] = { ...users[userIndex], ...updates };
    saveUserDatabase(users);

    return users[userIndex];
}

function legacyDeleteUser(userId) {
    const users = getUserDatabase();
    const filteredUsers = users.filter(user => user.id !== userId);
    saveUserDatabase(filteredUsers);
}

function getUsersByRole(role) {
    const users = getUserDatabase();
    return users.filter(user => user.role === role);
}

function updateUserInDatabase(user) {
    const users = getUserDatabase();
    const existingIndex = users.findIndex(u => u.id === user.id);

    if (existingIndex !== -1) {
        users[existingIndex] = { ...users[existingIndex], ...user };
    } else {
        users.push(user);
    }

    saveUserDatabase(users);
}

// Activity tracking
function trackUserActivity(user, action) {
    const activity = {
        userId: user.id,
        userName: user.name,
        action: action,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        ip: 'unknown' // In production, get from server
    };

    const activities = JSON.parse(localStorage.getItem('userActivities') || '[]');
    activities.push(activity);

    // Keep only last 1000 activities
    if (activities.length > 1000) {
        activities.splice(0, activities.length - 1000);
    }

    localStorage.setItem('userActivities', JSON.stringify(activities));
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

    // User database
    getUserDatabase,
    getUserById,
    getUserByEmail,
    createUser,
    legacyUpdateUser,
    legacyDeleteUser,
    getUsersByRole,

    // Authentik SSO
    initiateAuthentikLogin,
    handleAuthentikCallback,
    refreshAuthentikToken,

    // Constants
    ROLES: USER_ROLES,
    PERMISSIONS: ROLE_PERMISSIONS,

    // Legacy compatibility
    trackActivity: (action) => {
        const user = getCurrentUser();
        if (user) {
            trackUserActivity(user, action);
        }
    }
};

} // End of AUTH_LOADED guard