/**
 * NanoURL — API Client
 * Handles all API calls with JWT token management
 */

const API_BASE = '/api';

class NanoURLAPI {
  constructor() {
    this.accessToken = localStorage.getItem('accessToken');
    this.user = JSON.parse(localStorage.getItem('user') || 'null');
  }

  // ---- Auth State ----
  isAuthenticated() {
    return !!this.accessToken;
  }

  getUser() {
    return this.user;
  }

  setAuth(user, accessToken) {
    this.user = user;
    this.accessToken = accessToken;
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('accessToken', accessToken);
  }

  clearAuth() {
    this.user = null;
    this.accessToken = null;
    localStorage.removeItem('user');
    localStorage.removeItem('accessToken');
  }

  // ---- HTTP Client ----
  async request(method, path, body = null, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const config = {
      method,
      headers,
      credentials: 'include',
    };

    if (body && method !== 'GET') {
      config.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, config);

      // Handle token expiration
      if (response.status === 401) {
        const data = await response.json();
        if (data.code === 'TOKEN_EXPIRED') {
          const refreshed = await this.refreshToken();
          if (refreshed) {
            // Retry the original request
            headers['Authorization'] = `Bearer ${this.accessToken}`;
            config.headers = headers;
            const retryResponse = await fetch(`${API_BASE}${path}`, config);
            return retryResponse.json();
          }
        }
        // If refresh failed, clear auth and redirect to login
        this.clearAuth();
        if (!options.noRedirect) {
          window.location.href = '/login';
        }
        throw new Error('Authentication required');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong');
      }

      return data;
    } catch (err) {
      if (err.message === 'Authentication required') throw err;
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Network error. Please check your connection.');
      }
      throw err;
    }
  }

  async refreshToken() {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        this.accessToken = data.data.accessToken;
        localStorage.setItem('accessToken', this.accessToken);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ---- Auth APIs ----
  async signup(email, password, displayName) {
    const data = await this.request('POST', '/auth/signup', { email, password, displayName });
    this.setAuth(data.data.user, data.data.accessToken);
    return data.data;
  }

  async login(email, password) {
    const data = await this.request('POST', '/auth/login', { email, password });
    this.setAuth(data.data.user, data.data.accessToken);
    return data.data;
  }

  async logout() {
    try {
      await this.request('POST', '/auth/logout', null, { noRedirect: true });
    } catch { }
    this.clearAuth();
  }

  async getProfile() {
    const data = await this.request('GET', '/auth/profile');
    return data.data;
  }

  // ---- URL APIs ----
  async shortenUrl(url, options = {}) {
    const data = await this.request('POST', '/shorten', { url, ...options }, { noRedirect: true });
    return data.data;
  }

  async getLinks(page = 1, limit = 20, search = '', status = '') {
    const params = new URLSearchParams({ page, limit });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    const data = await this.request('GET', `/links?${params}`);
    return data.data;
  }

  async getLink(id) {
    const data = await this.request('GET', `/links/${id}`);
    return data.data;
  }

  async updateLink(id, updates) {
    const data = await this.request('PUT', `/links/${id}`, updates);
    return data.data;
  }

  async deleteLink(id) {
    const data = await this.request('DELETE', `/links/${id}`);
    return data.data;
  }

  async getQRCode(id) {
    const data = await this.request('GET', `/links/${id}/qr`);
    return data.data;
  }

  // ---- Analytics APIs ----
  async getDashboardStats() {
    const data = await this.request('GET', '/analytics/dashboard');
    return data.data;
  }

  async getLinkAnalytics(id) {
    const data = await this.request('GET', `/analytics/${id}`);
    return data.data;
  }

  async getTimeSeries(id, interval = 'day', days = 30) {
    const data = await this.request('GET', `/analytics/${id}/timeseries?interval=${interval}&days=${days}`);
    return data.data;
  }

  // ---- Payment APIs ----
  async createSubscription(planType) {
    const data = await this.request('POST', '/payments/create-subscription', { planType });
    return data.data;
  }

  async getSubscriptionStatus() {
    const data = await this.request('GET', '/payments/status');
    return data.data;
  }
}

// Global instance
window.api = new NanoURLAPI();

// Toast utility
window.showToast = function (message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
};

// Copy to clipboard utility
window.copyToClipboard = async function (text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard!', 'success');
  } catch {
    // Fallback
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast('Copied to clipboard!', 'success');
  }
};
