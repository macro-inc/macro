import { Capacitor } from '@capacitor/core';

const platform = Capacitor.getPlatform();

export function isNativeMobilePlatform() {
  if (platform === 'ios' || platform === 'android') {
    return platform;
  }

  return false;
}
