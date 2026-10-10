import { gzipSync } from 'node:zlib';
import { type Settings, validateSettings } from './settings';

// Nix owns service configuration. User data carries only validated runtime values.
export function renderUserData(settings: Settings): string {
  validateSettings(settings);
  const compressed = gzipSync(JSON.stringify({ version: 5, settings }));
  if (compressed.length > 16 * 1024) {
    throw new Error('Configuration exceeds the EC2 user-data limit');
  }
  return compressed.toString('base64');
}
