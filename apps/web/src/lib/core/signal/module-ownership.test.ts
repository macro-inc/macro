import { afterEach, describe, expect, it, vi } from 'vitest';

// Modules that app startup loads and that create Solid state at module scope.
// Each one used to create memos, effects, cleanups or components without an
// owner, which Solid's dev build reports and never disposes.
const STARTUP_MODULES: Record<string, () => Promise<unknown>> = {
  tabFocus: () => import('./tabFocus'),
  themeSignals: () => import('@app/features/theme/signals/themeSignals'),
  storageWebsocket: () =>
    import('@app/lib/service-clients/service-storage/websocket'),
  connectionWebsocket: () =>
    import('@app/lib/service-clients/service-connection/websocket'),
  onboardingTrustDetails: () =>
    import('@app/features/onboarding/components/trust-details'),
  formatTools: () => import('@app/features/block-md/component/FormatTools'),
};

describe('startup modules', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.keys(STARTUP_MODULES))(
    '%s creates no unowned Solid computations or cleanups',
    async (name) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await STARTUP_MODULES[name]();
      const ownershipWarnings = warn.mock.calls.filter(
        ([message]) =>
          typeof message === 'string' &&
          message.includes('outside a `createRoot` or `render`')
      );
      expect(ownershipWarnings).toEqual([]);
    },
    // The editor and websocket modules pull in large import graphs.
    60_000
  );
});
