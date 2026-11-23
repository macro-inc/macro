import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

type FlagAnswer = { enabled: boolean; loading: boolean };

vi.mock('@app/lib/analytics/posthog', async () => {
  const solid = await import('solid-js');
  const [read, write] = solid.createSignal<FlagAnswer>({
    enabled: false,
    loading: true,
  });
  return { useFeatureFlag: () => read, __setFlag: write };
});
vi.mock('@service-storage/graphql-soup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service-storage/graphql-soup')>()),
  getGraphqlSoupCacheHost: () => ({}),
  graphqlCacheEnabled: () => true,
}));
vi.mock('../local/channel-flag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../local/channel-flag')>()),
  channelCacheSupported: () => true,
}));

const { useChannelReadPath } = await import('../channel-timeline-source');
const posthog = (await import('@app/lib/analytics/posthog')) as unknown as {
  __setFlag: (next: FlagAnswer) => void;
};

describe('useChannelReadPath', () => {
  it('reads over REST at once while the flag has no answer, and stays there', () => {
    posthog.__setFlag({ enabled: false, loading: true });
    const [parent] = createSignal({ type: 'channel' as const, id: 'c1' });

    const path = createRoot(() => useChannelReadPath(parent));
    expect(path.mode()).toBe('rest');

    posthog.__setFlag({ enabled: true, loading: false });
    expect(path.mode()).toBe('rest');
  });

  it('reads from the device when the flag is on at mount, and stays there', () => {
    posthog.__setFlag({ enabled: true, loading: false });
    const [parent] = createSignal({ type: 'channel' as const, id: 'c1' });

    const path = createRoot(() => useChannelReadPath(parent));
    expect(path.mode()).toBe('local');

    posthog.__setFlag({ enabled: false, loading: false });
    expect(path.mode()).toBe('local');

    path.setUnsupported();
    expect(path.mode()).toBe('rest');
  });
});
