// API utility functions for communicating with the backend

// Guard against double-loading
if (window.API_LOADED) {
    // Already loaded, skip
} else {
    window.API_LOADED = true;

const API_BASE_URL = window.location.origin;

class ApiClient {
    constructor() {
        this.token = localStorage.getItem('authToken');
        this.refreshing = false;
        this.refreshQueue = [];
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('authToken', token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('authToken');
    }

    async refreshTokenIfNeeded() {
        // If already refreshing, wait for it to complete
        if (this.refreshing) {
            return new Promise((resolve) => {
                this.refreshQueue.push(resolve);
            });
        }

        // Try to refresh token
        if (this.token) {
            this.refreshing = true;
            try {
                const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.token) {
                        this.setToken(data.token);
                    }
                }
            } catch (error) {
                // Silently fail refresh attempt
            } finally {
                this.refreshing = false;
                // Resolve all queued requests
                this.refreshQueue.forEach(resolve => resolve());
                this.refreshQueue = [];
            }
        }
    }

    async request(method, endpointOrOptions, optionsOrData = {}) {
        // Handle both old and new signatures:
        // Old: request(endpoint, options)
        // New: request(method, endpoint, data)
        
        let endpoint, options;
        
        // If first param looks like a method (GET, POST, etc), use new signature
        if (typeof method === 'string' && ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
            // New signature: request(method, endpoint, data)
            const httpMethod = method.toUpperCase();
            endpoint = endpointOrOptions;
            
            // Build options with method and body
            options = {
                method: httpMethod
            };
            
            // Add body for non-GET requests with data
            if (optionsOrData && Object.keys(optionsOrData).length > 0 && httpMethod !== 'GET') {
                options.body = JSON.stringify(optionsOrData);
            }
            
            // Merge any additional options (headers, etc)
            if (optionsOrData.headers) {
                options.headers = optionsOrData.headers;
            }
        } else {
            // Old signature: request(endpoint, options)
            endpoint = method;
            options = endpointOrOptions || {};
        }

        // Refresh token before making request
        await this.refreshTokenIfNeeded();

        const url = `${API_BASE_URL}/api${endpoint}`;
        const config = {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        };

        // Add body if present
        if (options.body) {
            config.body = options.body;
        }

        // Copy other options (like credentials)
        Object.keys(options).forEach(key => {
            if (!['method', 'headers', 'body'].includes(key)) {
                config[key] = options[key];
            }
        });

        if (this.token) {
            config.headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(url, config);

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Network error' }));
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    // Authentication endpoints
    async login(email, password) {
        try {
            // Make direct request to handle 403 responses specially
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                // For login endpoint, 403 responses are special (enrollment required, account disabled, etc)
                if (response.status === 403) {
                    // Return 403 responses as-is for login.html to handle
                    return data;
                }
                // For other errors, throw
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            if (data.token) {
                this.setToken(data.token);
            }

            return data;
        } catch (error) {
            console.error('Login request failed:', error);
            throw error;
        }
    }

    async logout() {
        try {
            await this.request('/auth/logout', { method: 'POST' });
        } finally {
            this.clearToken();
        }
    }

    async getCurrentUser() {
        return await this.request('/auth/me');
    }

    async refreshToken() {
        const response = await this.request('/auth/refresh', { method: 'POST' });
        if (response.token) {
            this.setToken(response.token);
        }
        return response;
    }

    // User management endpoints
    async getUsers() {
        return await this.request('/users');
    }

    async getUser(id) {
        return await this.request(`/users/${id}`);
    }

    async createUser(userData) {
        return await this.request('/users', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    }

    async updateUser(id, userData) {
        return await this.request(`/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(userData)
        });
    }

    async deleteUser(id) {
        return await this.request(`/users/${id}`, { method: 'DELETE' });
    }

    async getUserActivity(id, limit = 50) {
        return await this.request(`/users/${id}/activity?limit=${limit}`);
    }

    // Initialize demo users (admin only)
    async initDemoUsers() {
        return await this.request('/auth/init-demo-users', { method: 'POST' });
    }

    // Settings endpoints
    async getSettings() {
        return await this.request('/settings');
    }

    async getSetting(key) {
        return await this.request(`/settings/${key}`);
    }

    async updateSetting(key, value, category = null, scope = 'user') {
        return await this.request(`/settings/${key}`, {
            method: 'PUT',
            body: JSON.stringify({ value, category, scope })
        });
    }

    async updateSettings(settings, scope = 'user') {
        return await this.request('/settings', {
            method: 'PUT',
            body: JSON.stringify({ settings, scope })
        });
    }

    async deleteSetting(key, scope = 'user') {
        return await this.request(`/settings/${key}`, {
            method: 'DELETE',
            body: JSON.stringify({ scope })
        });
    }
}

// Create global API client instance
window.Api = new ApiClient();

} // End of API_LOADED guard