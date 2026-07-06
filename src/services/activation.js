import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import axios from 'axios';
import { setBrand, clearBrand } from './brand';

/**
 * Device activation (Tier 3 of the White-Glove model).
 *
 * The single master binary pairs to a practice with a one-time 6-digit
 * Device Sync PIN, then stores that practice's API base + branding so it
 * skins itself and talks to the right backend.
 *
 * Provisioning always lives on the master platform.
 */
const MASTER_BASE = 'https://app.revenuivaai.com/api';

/** Stable per-install hardware id. */
async function getHardwareId() {
  let id = await SecureStore.getItemAsync('hardware_id');
  if (!id) {
    const seed = `${Device.osBuildId || ''}-${Device.modelName || ''}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    id = 'hw_' + seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
    await SecureStore.setItemAsync('hardware_id', id);
  }
  return id;
}

/** Activate this device with a 6-digit Device Sync PIN. */
export async function activate(pin) {
  const hardwareId = await getHardwareId();
  const { data } = await axios.post(
    `${MASTER_BASE}/pos/activate`,
    {
      pin: String(pin).trim(),
      hardware_id: hardwareId,
      device_model: Device.modelName || 'Unknown',
      device_os: `${Device.osName || Platform.OS} ${Device.osVersion || ''}`.trim(),
      device_name: Device.deviceName || 'Front Desk Device',
      app_type: 'register',
    },
    { timeout: 15000, headers: { Accept: 'application/json' } }
  );

  if (!data?.success) {
    throw new Error(data?.error || 'Activation failed.');
  }

  const cfg = data.config || {};
  // Operational API base for this practice (falls back to master).
  const apiBase = (cfg.apiBase || `${MASTER_BASE}`).replace(/\/$/, '');

  await SecureStore.setItemAsync('device_token', data.device_token || '');
  await SecureStore.setItemAsync('api_base', apiBase);
  await SecureStore.setItemAsync('tenant_id', String(cfg.tenantId || ''));
  await SecureStore.setItemAsync('activation_config', JSON.stringify(cfg));
  await setBrand(cfg.branding || {});

  return cfg;
}

export async function isActivated() {
  const t = await SecureStore.getItemAsync('device_token');
  return !!t;
}

export async function getApiBase() {
  return (await SecureStore.getItemAsync('api_base')) || MASTER_BASE;
}

export async function getDeviceToken() {
  return await SecureStore.getItemAsync('device_token');
}

/** Remove pairing (e.g. to re-pair to a different practice). */
export async function deactivate() {
  for (const k of ['device_token', 'api_base', 'tenant_id', 'activation_config', 'auth_token', 'user_name', 'user_email']) {
    await SecureStore.deleteItemAsync(k);
  }
  await clearBrand();
}
