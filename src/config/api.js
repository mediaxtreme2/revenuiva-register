import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Fallback base if the device hasn't been activated yet. Once a device is
// paired via a Device Sync PIN, the practice-specific base is used instead.
const FALLBACK_POS_BASE = 'https://app.revenuivaai.com/api/pos';

const api = axios.create({
  timeout: 15000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

api.interceptors.request.use(async (config) => {
  // Resolve the per-practice API base dynamically from activation.
  const apiBase = await SecureStore.getItemAsync('api_base');
  config.baseURL = apiBase ? `${apiBase.replace(/\/$/, '')}/pos` : FALLBACK_POS_BASE;

  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const deviceToken = await SecureStore.getItemAsync('device_token');
  if (deviceToken) config.headers['X-Device-Token'] = deviceToken;

  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync('auth_token');
    }
    return Promise.reject(error);
  }
);

export default api;
