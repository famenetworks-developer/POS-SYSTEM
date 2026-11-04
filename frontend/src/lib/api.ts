const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim();

// Same-origin is the production default. Vite proxies this path to the local
// API during development, while Nginx proxies it in the container image.
export const API_BASE = (configuredApiBase || '/api/v1').replace(/\/$/, '');

export class ApiError extends Error {
  code: string;
  details?: any;

  constructor(message: string, code: string = 'API_ERROR', details?: any) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

// Access tokens expire after 15 minutes. Refresh tokens are single-use (the server
// rotates them), so concurrent 401s share one in-flight refresh.
let refreshInFlight: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = localStorage.getItem('restoflow_refresh_token');
      if (!refreshToken) return false;
      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.data?.access_token) return false;
        localStorage.setItem('restoflow_token', data.data.access_token);
        localStorage.setItem('restoflow_refresh_token', data.data.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const token = localStorage.getItem('restoflow_token');
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const err = data?.error || {};
      if (response.status === 401 && err.code === 'INVALID_TOKEN' && token && !isRetry && !path.startsWith('/auth/')) {
        if (await refreshAccessToken()) {
          return apiRequest<T>(path, options, true);
        }
      }
      throw new ApiError(err.message || response.statusText, err.code || 'HTTP_ERROR', err.details);
    }

    return data?.data !== undefined ? data.data : data;
  } catch (error: any) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Network failure / offline
    throw new ApiError(error.message || 'Network request failed', 'NETWORK_ERROR');
  }
}

export const api = {
  get: <T = any>(path: string, options?: RequestInit) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T = any>(path: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(path, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T = any>(path: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(path, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T = any>(path: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(path, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T = any>(path: string, options?: RequestInit) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
