/**
 * The device under test, for agent navigation's mobile check: a test file
 * mocks `isNativeMobilePlatform` and `isTouchDevice` to read its own
 * `DeviceFlags`, and these hold the screen.
 */

import { onTestFinished, vi } from 'vitest';

type DeviceFlags = { nativeApp: boolean; touch: boolean };

/** Each kind of mobile device, as the mocked flags see it. */
export const MOBILE_DEVICES = [
  { on: 'the native app', nativeApp: true, touch: true },
  { on: 'a phone browser', nativeApp: false, touch: true },
] as const;

/** The device's screen is this size, in CSS pixels, until the test ends. */
export function holdScreen(width: number, height: number) {
  const spies = [
    vi.spyOn(screen, 'width', 'get').mockReturnValue(width),
    vi.spyOn(screen, 'height', 'get').mockReturnValue(height),
  ];
  onTestFinished(() => {
    for (const spy of spies) spy.mockRestore();
  });
}

/** Holds `device` as a mobile device on a portrait phone screen until the test ends. */
export function holdMobile(
  device: DeviceFlags,
  mobile: (typeof MOBILE_DEVICES)[number]
) {
  device.nativeApp = mobile.nativeApp;
  device.touch = mobile.touch;
  holdScreen(390, 844);
  onTestFinished(() => {
    device.nativeApp = false;
    device.touch = false;
  });
}
