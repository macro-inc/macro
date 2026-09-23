import type { RemoteFlag } from '@core/constant/featureFlags';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { FeatureFlagResult, PostHog } from 'posthog-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosthogProvider, ShowFeatureFlag, useFeatureFlag } from './posthog';

const posthog = vi.hoisted(() => ({
  onFeatureFlags: vi.fn<PostHog['onFeatureFlags']>(),
  getFeatureFlagResult: vi.fn<PostHog['getFeatureFlagResult']>(),
  unsubscribe: vi.fn(),
}));

vi.mock('./analytics-context', () => ({
  useAnalytics: () => ({ posthog }),
}));

const channelTags: RemoteFlag = {
  key: 'enable-channel-tags',
  override: undefined,
};

function receiveFlags(
  result: FeatureFlagResult | undefined,
  flags = result?.enabled ? [channelTags.key] : []
) {
  posthog.getFeatureFlagResult.mockReturnValue(result);
  const callback = posthog.onFeatureFlags.mock.calls[0]?.[0];
  if (!callback) throw new Error('PostHog provider is not mounted');
  callback(flags, result ? { [result.key]: result.enabled } : {});
}

function flagResult(enabled: boolean, payload?: string): FeatureFlagResult {
  return { key: channelTags.key, enabled, variant: undefined, payload };
}

function renderFlag(flag: RemoteFlag = channelTags) {
  let result!: ReturnType<typeof useFeatureFlag<string>>;
  const mount = vi.fn();
  const Probe = () => {
    mount();
    result = useFeatureFlag<string>(flag, { fallbackPayload: 'fallback' });
    return (
      <ShowFeatureFlag flag={flag}>
        <button>New label</button>
      </ShowFeatureFlag>
    );
  };
  const view = render(() => (
    <PosthogProvider>
      <Probe />
    </PosthogProvider>
  ));
  return { result, mount, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  posthog.getFeatureFlagResult.mockReset();
  posthog.onFeatureFlags.mockReturnValue(posthog.unsubscribe);
});
afterEach(cleanup);

describe('reactive PostHog flags', () => {
  it('hides unknown flags and applies rollout changes without remounting', () => {
    const view = renderFlag();

    expect(view.result()).toEqual({
      enabled: false,
      payload: 'fallback',
      loading: true,
    });
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();

    receiveFlags(undefined);
    expect(view.result().loading).toBe(false);
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();

    receiveFlags(flagResult(true));
    expect(view.result().enabled).toBe(true);
    expect(screen.getByRole('button', { name: 'New label' })).toBeTruthy();

    receiveFlags(flagResult(false));
    expect(view.result().enabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();
    expect(view.mount).toHaveBeenCalledOnce();

    view.unmount();
    expect(posthog.unsubscribe).toHaveBeenCalledOnce();
  });

  it('refreshes payloads when the enabled flag list is unchanged', () => {
    const view = renderFlag();
    const flags = [channelTags.key];

    receiveFlags(flagResult(true, 'first'), flags);
    expect(view.result().payload).toBe('first');

    receiveFlags(flagResult(true, 'second'), flags);
    expect(view.result().payload).toBe('second');
    expect(view.mount).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'keeps the explicit %s override authoritative',
    (override) => {
      const view = renderFlag({ ...channelTags, override });

      expect(view.result()).toEqual({
        enabled: override,
        payload: 'fallback',
        loading: false,
      });

      receiveFlags(flagResult(!override, 'remote'));
      expect(view.result()).toEqual({
        enabled: override,
        payload: 'fallback',
        loading: false,
      });
      expect(posthog.getFeatureFlagResult).not.toHaveBeenCalled();
    }
  );
});
