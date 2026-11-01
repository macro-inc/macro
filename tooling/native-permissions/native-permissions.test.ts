import { describe, expect, it } from 'bun:test';
import {
  MEDIA_ENTITLEMENTS,
  MEDIA_USAGE_KEYS,
  missingStrings,
  missingTrue,
} from './native-permissions';

describe('native media permissions', () => {
  it('requires a non-empty usage string for each key', () => {
    const plist = `<dict>
      <key>NSCameraUsageDescription</key>
      <string>Macro uses the camera for calls.</string>
      <key>NSMicrophoneUsageDescription</key>
      <string></string>
    </dict>`;
    expect(missingStrings(plist, MEDIA_USAGE_KEYS)).toEqual([
      'NSMicrophoneUsageDescription',
    ]);
  });

  it('requires each entitlement to be true', () => {
    const plist = `<dict>
      <key>com.apple.security.device.camera</key>
      <true/>
      <key>com.apple.security.device.audio-input</key>
      <false/>
    </dict>`;
    expect(missingTrue(plist, MEDIA_ENTITLEMENTS)).toEqual([
      'com.apple.security.device.audio-input',
    ]);
  });
});
