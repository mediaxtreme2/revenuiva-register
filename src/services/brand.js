import * as SecureStore from 'expo-secure-store';

/**
 * Holds the practice branding pulled at activation, so the app can skin
 * itself dynamically (single master binary, per-practice look).
 */
const DEFAULT_BRAND = {
  practiceName: 'RevenuivaAI',
  logoUrl: null,
  primaryColor: '#2563eb',
  secondaryColor: '#10b981',
};

let current = { ...DEFAULT_BRAND };

export function getBrand() {
  return current;
}

export async function loadBrand() {
  try {
    const raw = await SecureStore.getItemAsync('brand');
    if (raw) current = { ...DEFAULT_BRAND, ...JSON.parse(raw) };
  } catch (e) {}
  return current;
}

export async function setBrand(branding) {
  current = {
    practiceName: branding?.companyName || branding?.practiceName || DEFAULT_BRAND.practiceName,
    logoUrl: branding?.logoUrl || null,
    primaryColor: branding?.primaryColor || DEFAULT_BRAND.primaryColor,
    secondaryColor: branding?.secondaryColor || DEFAULT_BRAND.secondaryColor,
  };
  try {
    await SecureStore.setItemAsync('brand', JSON.stringify(current));
  } catch (e) {}
  return current;
}

export async function clearBrand() {
  current = { ...DEFAULT_BRAND };
  try {
    await SecureStore.deleteItemAsync('brand');
  } catch (e) {}
}
