// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  stop: vi.fn(),
  optOut: vi.fn(),
  config: vi.fn(),
  google: vi.fn(),
  meta: vi.fn(),
}));
vi.mock('posthog-js', () => ({
  PostHog: class {
    init = sdk.init;
    capture = sdk.capture;
    stopSessionRecording = sdk.stop;
    opt_out_capturing = sdk.optOut;
    set_config = sdk.config;
  },
}));
vi.mock('@app/lib/analytics/providers', () => ({
  initializeGoogleAnalytics: sdk.google,
  initializeMetaPixel: sdk.meta,
}));
vi.mock('@core/util/platform', () => ({ getPlatform: () => 'web' }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

describe('workspace analytics privacy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_POSTHOG_API_KEY', 'test-key');
    vi.stubGlobal('gtag', vi.fn());
    vi.stubGlobal('fbq', vi.fn());
  });

  it('sends nothing, including SDK bootstrap, until policy explicitly permits it', async () => {
    const { analytics } = await import('./analytics');
    analytics.track('test');
    analytics.setPrivacyPermission(undefined);
    analytics.setPrivacyPermission(false);
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.google).not.toHaveBeenCalled();
    expect(sdk.meta).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
    analytics.setPrivacyPermission(true);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    analytics.track('test');
    expect(sdk.capture).toHaveBeenCalledTimes(1);
  });

  it('revokes capture, replay and queued events without re-enabling in the same page', async () => {
    const { analytics } = await import('./analytics');
    analytics.setPrivacyPermission(true);
    const beforeSend = sdk.init.mock.calls[0][1].before_send;
    analytics.setPrivacyPermission(false);
    analytics.track('test');
    analytics.setPrivacyPermission(true);
    expect(analytics.isAllowed()).toBe(false);
    expect(sdk.stop).toHaveBeenCalledTimes(1);
    expect(sdk.optOut).toHaveBeenCalledTimes(1);
    expect(
      beforeSend({ event: 'queued', properties: { patient: 'secret' } })
    ).toBeNull();
    expect(sdk.capture).not.toHaveBeenCalled();
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });
});
