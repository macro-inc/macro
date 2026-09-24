/** @vitest-environment jsdom */
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { enableQuickCalls } from '@core/constant/featureFlags';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useQuickCallsFlag } from './use-quick-calls-flag';

const posthog = vi.hoisted(() => ({
  result: undefined as { enabled: boolean } | undefined,
  listener: undefined as
    | ((
        flags: string[],
        variants: object,
        context?: { errorsLoading: boolean }
      ) => void)
    | undefined,
  unsubscribe: vi.fn(),
  getFeatureFlagResult: vi.fn(),
}));

vi.mock('@app/lib/analytics', () => ({ analytics: { posthog: {} } }));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({
    posthog: {
      onFeatureFlags: (listener: typeof posthog.listener) => {
        posthog.listener = listener;
        return posthog.unsubscribe;
      },
      getFeatureFlagResult: posthog.getFeatureFlagResult,
    },
  }),
}));

beforeEach(() => {
  posthog.result = undefined;
  posthog.listener = undefined;
  posthog.getFeatureFlagResult.mockImplementation(() => posthog.result);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Probe() {
  const flag = useQuickCallsFlag();
  return (
    <span>
      {flag().loading ? 'loading' : flag().enabled ? 'enabled' : 'disabled'}
    </span>
  );
}

it('waits for PostHog and responds to subsequent flag changes', () => {
  expect(enableQuickCalls).toEqual({
    key: 'enable-quick-calls',
    override: undefined,
  });
  render(() => (
    <PosthogProvider>
      <Probe />
    </PosthogProvider>
  ));
  expect(screen.getByText('loading')).toBeTruthy();

  const flags = ['enable-quick-calls'];
  posthog.result = { enabled: false };
  posthog.listener?.(flags, {});
  expect(screen.getByText('disabled')).toBeTruthy();

  posthog.result = { enabled: true };
  posthog.listener?.(flags, {});
  expect(screen.getByText('enabled')).toBeTruthy();
  expect(posthog.getFeatureFlagResult).toHaveBeenLastCalledWith(
    'enable-quick-calls'
  );

  posthog.result = { enabled: false };
  posthog.listener?.(flags, {});
  expect(screen.getByText('disabled')).toBeTruthy();
});

it('stays disabled if PostHog cannot load flags', () => {
  render(() => (
    <PosthogProvider>
      <Probe />
    </PosthogProvider>
  ));
  posthog.listener?.([], {}, { errorsLoading: true });
  expect(screen.getByText('disabled')).toBeTruthy();
});
