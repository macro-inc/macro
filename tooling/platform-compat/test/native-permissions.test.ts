import { describe, expect, it } from 'bun:test';
import { parseBrowserFloor } from '../src/browser-floor';
import {
  MEDIA_ENTITLEMENTS,
  MEDIA_USAGE_KEYS,
  missingStrings,
  missingTrue,
} from '../src/native-permissions';

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

describe('browser floor', () => {
  it('maps browserslist names to compatibility data ids', () => {
    expect([
      ...parseBrowserFloor(['ios_saf >= 15.4', 'and_chr >= 111']),
    ]).toEqual([
      ['safari_ios', '15.4'],
      ['chrome_android', '111'],
    ]);
  });

  it('rejects queries the build target cannot use', () => {
    expect(() => parseBrowserFloor(['last 2 versions'])).toThrow(
      'Unsupported browserslist query: last 2 versions'
    );
  });
});
