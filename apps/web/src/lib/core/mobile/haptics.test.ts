import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { beforeEach, expect, it, vi } from 'vitest';
import { hapticImpact } from './haptics';
import { isNativeMobilePlatform } from './isNativeMobilePlatform';

vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));
vi.mock('./isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it('asks the native haptics plugin for the impact in the iOS and Android apps', () => {
  vi.mocked(isNativeMobilePlatform).mockReturnValue(true);
  vi.mocked(impactFeedback).mockResolvedValue();
  hapticImpact('medium');
  expect(impactFeedback).toHaveBeenCalledExactlyOnceWith('medium');
});

it('does nothing in a browser', () => {
  vi.mocked(isNativeMobilePlatform).mockReturnValue(false);
  hapticImpact('light');
  expect(impactFeedback).not.toHaveBeenCalled();
});

// A rejection that escaped would fail the run as an unhandled rejection.
it('ignores a device without a vibrator', async () => {
  vi.mocked(isNativeMobilePlatform).mockReturnValue(true);
  vi.mocked(impactFeedback).mockRejectedValue(new Error('unsupported'));
  hapticImpact('light');
  expect(impactFeedback).toHaveBeenCalledExactlyOnceWith('light');
  await new Promise((resolve) => setTimeout(resolve));
});
