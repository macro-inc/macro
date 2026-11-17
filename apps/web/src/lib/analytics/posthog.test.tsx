import type { RemoteFlag } from '@core/constant/featureFlags';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { FeatureFlagResult, PostHog } from 'posthog-js';
import { type JSX, lazy, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlagStore, type FlagStore } from './flag-store';
import { PosthogProvider, ShowFeatureFlag, useFeatureFlag } from './posthog';

const posthog = vi.hoisted(() => ({
  onFeatureFlags: vi.fn<PostHog['onFeatureFlags']>(),
  reloadFeatureFlags: vi.fn(),
  get_property: vi.fn(),
  getFeatureFlagResult: vi.fn<PostHog['getFeatureFlagResult']>(),
  featureFlags: { getFlags: vi.fn<() => string[]>() },
  unsubscribe: vi.fn(),
}));

vi.mock('./analytics-context', () => ({
  useAnalytics: () => ({ posthog }),
}));

// A fresh flag store per test; the app shares one module-level store.
const store = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('./flag-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./flag-store')>();
  return {
    ...actual,
    get flagStore() {
      return store.current;
    },
  };
});

const channelTags: RemoteFlag = {
  key: 'enable-channel-tags',
  override: undefined,
};

async function receiveFlags(
  result: FeatureFlagResult | undefined,
  flags = result?.enabled ? [channelTags.key] : []
) {
  posthog.getFeatureFlagResult.mockReturnValue(result);
  const callback = posthog.onFeatureFlags.mock.calls[0]?.[0];
  if (!callback) throw new Error('PostHog provider is not mounted');
  callback(flags, result ? { [result.key]: result.enabled } : {});
  await new Promise((resolve) => setTimeout(resolve));
}

/** The flag request got no answer: blocked, offline, or PostHog is down. */
async function failToReachPostHog(cached?: FeatureFlagResult) {
  posthog.getFeatureFlagResult.mockReturnValue(cached);
  const callback = posthog.onFeatureFlags.mock.calls[0]?.[0];
  if (!callback) throw new Error('PostHog provider is not mounted');
  callback([], {}, { errorsLoading: true });
  await new Promise((resolve) => setTimeout(resolve));
}

function flagResult(enabled: boolean, payload?: string): FeatureFlagResult {
  return { key: channelTags.key, enabled, variant: undefined, payload };
}

function renderFlag(
  flag: RemoteFlag = channelTags,
  opts: { enabledWhenUnreachable?: boolean } = {}
) {
  let result!: ReturnType<typeof useFeatureFlag<string>>;
  const mount = vi.fn();
  const Probe = () => {
    mount();
    result = useFeatureFlag<string>(flag, {
      fallbackPayload: 'fallback',
      ...opts,
    });
    return (
      <ShowFeatureFlag flag={flag}>
        <button>New label</button>
      </ShowFeatureFlag>
    );
  };
  flagStore().connect(posthog);
  const view = render(() => (
    <PosthogProvider>
      <Probe />
    </PosthogProvider>
  ));
  return { result, mount, ...view };
}

function flagStore() {
  return store.current as FlagStore;
}

beforeEach(() => {
  store.current = createFlagStore();
  localStorage.clear();
  vi.clearAllMocks();
  posthog.getFeatureFlagResult.mockReset();
  posthog.featureFlags.getFlags.mockReturnValue([]);
  posthog.onFeatureFlags.mockReturnValue(posthog.unsubscribe);
});
afterEach(cleanup);

describe('reactive PostHog flags', () => {
  it('hides unknown flags and applies rollout changes without remounting', async () => {
    const view = renderFlag();

    expect(view.result()).toEqual({
      enabled: false,
      payload: 'fallback',
      loading: true,
    });
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();

    await receiveFlags(undefined);
    expect(view.result().loading).toBe(false);
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();

    await receiveFlags(flagResult(true));
    expect(view.result().enabled).toBe(true);
    expect(screen.getByRole('button', { name: 'New label' })).toBeTruthy();

    await receiveFlags(flagResult(false));
    expect(view.result().enabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();
    expect(view.mount).toHaveBeenCalledOnce();
  });

  it('refreshes payloads when the enabled flag list is unchanged', async () => {
    const view = renderFlag();
    const flags = [channelTags.key];

    await receiveFlags(flagResult(true, 'first'), flags);
    expect(view.result().payload).toBe('first');

    await receiveFlags(flagResult(true, 'second'), flags);
    expect(view.result().payload).toBe('second');
    expect(view.mount).toHaveBeenCalledOnce();
  });

  it('keeps painted content while a flag-enabled lazy view loads', async () => {
    let resolveView!: (view: { default: () => JSX.Element }) => void;
    const LazyView = lazy(
      () =>
        new Promise<{ default: () => JSX.Element }>((r) => (resolveView = r))
    );
    flagStore().connect(posthog);
    render(() => (
      <PosthogProvider>
        <Suspense fallback={<p>Suspense fallback</p>}>
          <ShowFeatureFlag flag={channelTags} fallback={<p>Painted</p>}>
            <LazyView />
          </ShowFeatureFlag>
        </Suspense>
      </PosthogProvider>
    ));
    expect(screen.getByText('Painted')).toBeTruthy();

    await receiveFlags(flagResult(true));
    expect(screen.queryByText('Suspense fallback')).toBeNull();
    expect(screen.getByText('Painted')).toBeTruthy();

    resolveView({ default: () => <button>New label</button> });
    expect(
      await screen.findByRole('button', { name: 'New label' })
    ).toBeTruthy();
    expect(screen.queryByText('Painted')).toBeNull();
    expect(screen.queryByText('Suspense fallback')).toBeNull();
  });

  it('serves cached flags before PostHog answers, then applies the answer', async () => {
    posthog.featureFlags.getFlags.mockReturnValue([channelTags.key]);
    posthog.getFeatureFlagResult.mockReturnValue(flagResult(true, 'cached'));
    const view = renderFlag();

    expect(view.result()).toEqual({
      enabled: true,
      payload: 'cached',
      loading: false,
    });
    expect(screen.getByRole('button', { name: 'New label' })).toBeTruthy();

    await receiveFlags(flagResult(false));
    expect(view.result().enabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();
    expect(view.mount).toHaveBeenCalledOnce();
  });

  it('treats an unreachable PostHog as flags-off by default', async () => {
    const view = renderFlag();

    await failToReachPostHog();
    expect(view.result()).toEqual({
      enabled: false,
      payload: 'fallback',
      loading: false,
    });
  });

  it('lets a reader stay on while PostHog is unreachable, until it answers off', async () => {
    const view = renderFlag(channelTags, { enabledWhenUnreachable: true });
    expect(view.result().enabled).toBe(false);

    await failToReachPostHog();
    expect(view.result()).toEqual({
      enabled: true,
      payload: 'fallback',
      loading: false,
    });

    await receiveFlags(flagResult(false));
    expect(view.result().enabled).toBe(false);

    // The earlier "off" is still what PostHog last said.
    await failToReachPostHog(flagResult(false));
    expect(view.result().enabled).toBe(false);
    expect(view.mount).toHaveBeenCalledOnce();
  });

  it('does not turn a missing flag on when PostHog did answer', async () => {
    const view = renderFlag(channelTags, { enabledWhenUnreachable: true });

    await receiveFlags(undefined);
    expect(view.result()).toEqual({
      enabled: false,
      payload: 'fallback',
      loading: false,
    });
  });

  it.each([false, true])(
    'keeps the explicit %s override authoritative',
    async (override) => {
      const view = renderFlag({ ...channelTags, override });

      expect(view.result()).toEqual({
        enabled: override,
        payload: 'fallback',
        loading: false,
      });

      await receiveFlags(flagResult(!override, 'remote'));
      expect(view.result()).toEqual({
        enabled: override,
        payload: 'fallback',
        loading: false,
      });
      expect(posthog.getFeatureFlagResult).not.toHaveBeenCalled();
    }
  );
});

describe('backend flags when PostHog fails', () => {
  const account = (flags: Record<string, boolean | string>) => ({
    userId: 'macro|flags@example.com',
    fetchFlags: vi.fn(async () => flags),
  });

  it('shows a flag released to the user after PostHog times out', async () => {
    const view = renderFlag();
    flagStore().setAccount(account({ [channelTags.key]: true }));
    await new Promise((resolve) => setTimeout(resolve));

    expect(view.result()).toEqual({
      enabled: true,
      payload: 'fallback',
      loading: false,
    });
    expect(screen.getByRole('button', { name: 'New label' })).toBeTruthy();

    await failToReachPostHog();
    expect(view.result().enabled).toBe(true);
    expect(view.mount).toHaveBeenCalledOnce();
  });

  it('keeps a flag the user was not given off after PostHog fails', async () => {
    const view = renderFlag();
    flagStore().setAccount(account({ [channelTags.key]: false }));

    await failToReachPostHog();
    expect(view.result().enabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();
  });

  it("lets PostHog's own answer win once it arrives", async () => {
    const view = renderFlag();
    flagStore().setAccount(account({ [channelTags.key]: true }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(view.result().enabled).toBe(true);

    await receiveFlags(flagResult(false, 'remote'));
    expect(view.result()).toEqual({
      enabled: false,
      payload: 'remote',
      loading: false,
    });
  });

  it("prefers the backend over an earlier visit's cache", async () => {
    posthog.featureFlags.getFlags.mockReturnValue([channelTags.key]);
    posthog.getFeatureFlagResult.mockReturnValue(flagResult(true, 'cached'));
    const view = renderFlag();
    expect(view.result().enabled).toBe(true);
    const backend = account({ [channelTags.key]: false });
    flagStore().setAccount(backend);
    // A returning user reads the backend only once PostHog fails.
    expect(backend.fetchFlags).not.toHaveBeenCalled();

    await failToReachPostHog(flagResult(true, 'cached'));
    expect(backend.fetchFlags).toHaveBeenCalledOnce();
    expect(view.result()).toEqual({
      enabled: false,
      payload: 'fallback',
      loading: false,
    });
  });
});
