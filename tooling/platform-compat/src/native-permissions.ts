/** Info.plist keys without which WebKit hides `navigator.mediaDevices`. */
export const MEDIA_USAGE_KEYS = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];

/** Hardened-runtime entitlements a signed macOS app needs to capture media. */
export const MEDIA_ENTITLEMENTS = [
  'com.apple.security.device.camera',
  'com.apple.security.device.audio-input',
];

function escapeKey(key: string): string {
  return key.replace(/[.]/g, '\\.');
}

/** Keys that are absent or have an empty string value. */
export function missingStrings(
  plist: string,
  keys: readonly string[]
): string[] {
  return keys.filter(
    (key) =>
      !new RegExp(
        `<key>${escapeKey(key)}</key>\\s*<string>[^<\\s][^<]*</string>`
      ).test(plist)
  );
}

/** Keys that are absent or not set to `<true/>`. */
export function missingTrue(plist: string, keys: readonly string[]): string[] {
  return keys.filter(
    (key) =>
      !new RegExp(`<key>${escapeKey(key)}</key>\\s*<true\\s*/>`).test(plist)
  );
}
