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

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
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
