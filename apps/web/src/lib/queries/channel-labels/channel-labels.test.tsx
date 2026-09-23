import type { ChannelLabelsList } from '@service-storage/generated/schemas/channelLabelsList';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useChannelLabelsData,
  useChannelLabelsQuery,
  useSmartTagPreviewQuery,
} from './channel-labels';
import { channelLabelKeys } from './keys';

const mocks = vi.hoisted(() => ({
  enabled: (): boolean => false,
  list: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.enabled() }),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    channelLabels: { list: mocks.list, preview: mocks.preview },
  },
}));
vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

const labels: ChannelLabelsList = {
  labels: [
    {
      id: 'support',
      name: 'Support',
      channelIds: ['channel-1'],
      channelCount: 1,
      sortOrder: 0,
      createdAt: '2026-09-22T00:00:00Z',
      updatedAt: '2026-09-22T00:00:00Z',
    },
  ],
};
let client: QueryClient;

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(ok(labels));
  mocks.preview
    .mockReset()
    .mockResolvedValue(ok({ channels: [], totalCount: 0 }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe('channel tag query rollout', () => {
  it('does not fetch while disabled and hides cached labels when switched off', async () => {
    const [enabled, setEnabled] = createSignal(false);
    mocks.enabled = enabled;
    client.setQueryData(channelLabelKeys.list.queryKey, labels);
    let data!: ReturnType<typeof useChannelLabelsData>;
    let query!: ReturnType<typeof useChannelLabelsQuery>;
    const Probe = () => {
      data = useChannelLabelsData();
      query = useChannelLabelsQuery();
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));

    expect(query.isEnabled).toBe(false);
    expect(data()).toBeUndefined();
    await client.invalidateQueries({
      queryKey: channelLabelKeys.list.queryKey,
    });
    expect(mocks.list).not.toHaveBeenCalled();

    setEnabled(true);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(data()).toEqual(labels.labels));

    setEnabled(false);
    await waitFor(() => expect(query.isEnabled).toBe(false));
    expect(data()).toBeUndefined();
    await client.invalidateQueries({
      queryKey: channelLabelKeys.list.queryKey,
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(channelLabelKeys.list.queryKey)).toEqual(labels);
  });

  it('only previews smart tags while enabled', async () => {
    const [enabled, setEnabled] = createSignal(false);
    const [pattern, setPattern] = createSignal('support');
    mocks.enabled = enabled;
    let preview!: ReturnType<typeof useSmartTagPreviewQuery>;
    const Probe = () => {
      preview = useSmartTagPreviewQuery(pattern);
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));

    expect(preview.isEnabled).toBe(false);
    expect(mocks.preview).not.toHaveBeenCalled();
    setEnabled(true);
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
    setEnabled(false);
    setPattern('sales');
    await waitFor(() => expect(preview.isEnabled).toBe(false));
    await client.invalidateQueries({ queryKey: channelLabelKeys._def });
    expect(mocks.preview).toHaveBeenCalledTimes(1);
  });
});
