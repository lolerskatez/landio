/**
 * Global Theme Management System
 * Handles dark mode, themes, and accessibility settings across all pages
 * Persists user preferences to localStorage and server
 */

class ThemeManager {
    constructor() {
        this.isDarkMode = localStorage.getItem('theme-preference') === 'dark';
        this.theme = localStorage.getItem('selected-theme') || 'pastel';
        this.fontSize = localStorage.getItem('font-size') || 'medium';
        this.highContrast = localStorage.getItem('high-contrast') === 'true';
        this.reduceMotion = localStorage.getItem('reduce-motion') === 'true';
        this.animations = localStorage.getItem('animations-enabled') !== 'false';
        
        // Try to load from server first
        this.loadFromServer().catch(() => {
            // Silently fail, will use localStorage values as fallback
            console.debug('Theme preferences not yet available from server');
        });
        
        // Apply saved preferences when DOM is ready
        if (document.body) {
            this.applyTheme();
        } else {
            // If DOM is not ready yet, wait for it
            document.addEventListener('DOMContentLoaded', () => this.applyTheme());
        }
    }

    /**
     * Load theme preferences from server
     */
    async loadFromServer() {
        try {
            // Only attempt to load from server if user is authenticated
            const token = localStorage.getItem('authToken');
            if (!token) {
                return; // Skip server load, use localStorage defaults
            }

            const response = await fetch('/api/settings/theme/preferences', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const prefs = data.preferences;
                
                this.isDarkMode = prefs.isDarkMode;
                this.theme = prefs.theme || 'pastel';
                this.fontSize = prefs.fontSize || 'medium';
                this.highContrast = prefs.highContrast || false;
                this.reduceMotion = prefs.reduceMotion || false;
                this.animations = prefs.animations !== false;
                
                // Update localStorage with server values
                this.syncToLocalStorage();
                
                // Apply theme if body is ready, otherwise wait for DOMContentLoaded
                if (document.body) {
                    this.applyTheme();
                } else {
                    document.addEventListener('DOMContentLoaded', () => this.applyTheme());
                }
            }
        } catch (error) {
            // Server not available or user not logged in, use localStorage
            console.debug('Could not load theme from server:', error);
        }
    }

    /**
     * Toggle dark mode and apply it globally
     */
    toggleDarkMode(enabled = null) {
        if (enabled === null) {
            this.isDarkMode = !this.isDarkMode;
        } else {
            this.isDarkMode = enabled;
        }
        this.applyTheme();
        this.savePreferences();
    }

    /**
     * Set the theme and apply it
     */
    setTheme(themeName) {
        this.theme = themeName;
        this.applyTheme();
        this.savePreferences();
    }

    /**
     * Set font size
     */
    setFontSize(size) {
        this.fontSize = size;
        this.applyTheme();
        this.savePreferences();
    }

    /**
     * Toggle high contrast
     */
    toggleHighContrast(enabled = null) {
        if (enabled === null) {
            this.highContrast = !this.highContrast;
        } else {
            this.highContrast = enabled;
        }
        this.applyTheme();
        this.savePreferences();
    }

    /**
     * Toggle reduce motion
     */
    toggleReduceMotion(enabled = null) {
        if (enabled === null) {
            this.reduceMotion = !this.reduceMotion;
        } else {
            this.reduceMotion = enabled;
        }
        this.applyTheme();
        this.savePreferences();
    }

    /**
     * Toggle animations
     */
    toggleAnimations(enabled = null) {
        if (enabled === null) {
            this.animations = !this.animations;
        } else {
            this.animations = enabled;
        }
        this.applyTheme();
        this.savePreferences();
    }

    /**
     * Apply current theme settings to the document
     */
    applyTheme() {
        const body = document.body;
        
        // Ensure body exists before applying classes
        if (!body) {
            console.warn('Theme.js: body element not yet available, will retry on DOMContentLoaded');
            return;
        }

        // Apply theme
        body.classList.remove('theme-pastel', 'theme-cyber', 'theme-mocha', 'theme-ice', 'theme-nature', 'theme-sunset');
        body.classList.add(`theme-${this.theme}`);

        // Apply dark mode
        if (this.isDarkMode) {
            body.classList.add('dark-mode');
        } else {
            body.classList.remove('dark-mode');
        }

        // Apply font size
        body.classList.remove('font-small', 'font-medium', 'font-large', 'font-extra-large');
        body.classList.add(`font-${this.fontSize}`);

        // Apply high contrast
        if (this.highContrast) {
            body.classList.add('high-contrast');
        } else {
            body.classList.remove('high-contrast');
        }

        // Apply animations
        if (this.animations && !this.reduceMotion) {
            body.classList.add('animations-enabled');
        } else {
            body.classList.remove('animations-enabled');
        }

        // Apply reduce motion
        if (this.reduceMotion) {
            body.classList.add('reduce-motion');
        } else {
            body.classList.remove('reduce-motion');
        }
    }

    /**
     * Sync preferences to localStorage
     */
    syncToLocalStorage() {
        localStorage.setItem('theme-preference', this.isDarkMode ? 'dark' : 'light');
        localStorage.setItem('selected-theme', this.theme);
        localStorage.setItem('font-size', this.fontSize);
        localStorage.setItem('high-contrast', this.highContrast.toString());
        localStorage.setItem('reduce-motion', this.reduceMotion.toString());
        localStorage.setItem('animations-enabled', this.animations.toString());
    }

    /**
     * Save preferences to both localStorage and server
     */
    savePreferences() {
        // Always save to localStorage as fallback
        this.syncToLocalStorage();
        
        // Try to save to server (async, non-blocking)
        this.saveToServer().catch(error => {
            console.debug('Could not save theme to server:', error);
            // Still saved to localStorage, so user won't lose preferences
        });
    }

    /**
     * Save theme preferences to server
     */
    async saveToServer() {
        try {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) {
                // User not logged in, skip server save
                return;
            }

            // Build payload with the current values
            // Always send isDarkMode since it's a boolean and has a definite value
            const payload = {
                isDarkMode: this.isDarkMode,
                theme: this.theme,
                fontSize: this.fontSize,
                highContrast: this.highContrast,
                reduceMotion: this.reduceMotion,
                animations: this.animations
            };

            const response = await fetch('/api/settings/theme/preferences', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Server returned ${response.status}`);
            }
        } catch (error) {
            console.debug('Theme save to server failed:', error);
            // Not critical - localStorage already saved
        }
    }

    /**
     * Sync theme preferences from settings object (used by settings page)
     */
    syncFromSettings(settings) {
        if (settings.darkMode !== undefined) this.isDarkMode = settings.darkMode;
        if (settings.theme !== undefined) this.theme = settings.theme;
        if (settings.fontSize !== undefined) this.fontSize = settings.fontSize;
        if (settings.highContrast !== undefined) this.highContrast = settings.highContrast;
        if (settings.reduceMotion !== undefined) this.reduceMotion = settings.reduceMotion;
        if (settings.animations !== undefined) this.animations = settings.animations;
        
        this.applyTheme();
        this.savePreferences();
    }

    /**
     * Get all current preferences
     */
    getPreferences() {
        return {
            darkMode: this.isDarkMode,
            theme: this.theme,
            fontSize: this.fontSize,
            highContrast: this.highContrast,
            reduceMotion: this.reduceMotion,
            animations: this.animations
        };
    }
}

// Create global theme manager instance
window.ThemeManager = new ThemeManager();

// Expose convenience functions
window.toggleDarkMode = (enabled) => window.ThemeManager.toggleDarkMode(enabled);
window.setTheme = (theme) => window.ThemeManager.setTheme(theme);
