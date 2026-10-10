import type { MacroConfig } from './types';

const STORAGE_KEYS = {
  API_TOKEN: 'macro_api_token',
  BASE_URL: 'macro_base_url',
} as const;

const DEFAULT_BASE_URL = 'https://macro.com';

export async function getConfig(): Promise<MacroConfig | null> {
  const result = await chrome.storage.sync.get([STORAGE_KEYS.API_TOKEN, STORAGE_KEYS.BASE_URL]);

  const apiToken = result[STORAGE_KEYS.API_TOKEN];
  if (!apiToken) {
    return null;
  }

  return {
    apiToken,
    baseUrl: result[STORAGE_KEYS.BASE_URL] || DEFAULT_BASE_URL,
  };
}

export async function saveConfig(config: MacroConfig): Promise<void> {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.API_TOKEN]: config.apiToken,
    [STORAGE_KEYS.BASE_URL]: config.baseUrl || DEFAULT_BASE_URL,
  });
}

export async function clearConfig(): Promise<void> {
  await chrome.storage.sync.remove([STORAGE_KEYS.API_TOKEN, STORAGE_KEYS.BASE_URL]);
}

export async function isAuthenticated(): Promise<boolean> {
  const config = await getConfig();
  return config !== null && config.apiToken.length > 0;
}
