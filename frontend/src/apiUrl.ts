const LOCAL_API_BASE_URL = 'http://localhost:3001'

export function resolveApiBaseUrl(configuredUrl?: string) {
  return (configuredUrl?.trim() || LOCAL_API_BASE_URL).replace(/\/+$/, '')
}

export const apiBaseUrl = resolveApiBaseUrl(import.meta.env?.VITE_API_BASE_URL)

export function apiUrl(path: string) {
  return `${apiBaseUrl}${path}`
}
