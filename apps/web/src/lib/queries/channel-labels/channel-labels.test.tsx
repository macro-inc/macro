import { catchToResult } from '@core/util/result';
import type { ChannelLabelsList } from '@service-storage/generated/schemas/channelLabelsList';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { type QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import {
  useChannelLabelsData,
  useChannelLabelsQuery,
  useSetChannelLabelMutation,
  useSmartTagPreviewQuery,
} from './channel-labels';
import { channelLabelKeys } from './keys';

const mocks = vi.hoisted(() => ({
  enabled: (): boolean => false,
  userId: (): string => 'viewer',
  list: vi.fn(),
  preview: vi.fn(),
  assign: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.enabled() }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => mocks.userId(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    channelLabels: {
      list: mocks.list,
      preview: mocks.preview,
      setChannelLabel: mocks.assign,
    },
  },
}));
vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

const labels: ChannelLabelsList = {
  scope: 'personal',
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
  mocks.userId = () => 'viewer';
  mocks.assign.mockReset().mockResolvedValue(ok(undefined));
  mocks.list.mockReset().mockResolvedValue(ok(labels));
  mocks.preview
    .mockReset()
    .mockResolvedValue(ok({ channels: [], totalCount: 0 }));
  client = queryClient;
  client.setDefaultOptions({
    queries: { retry: false },
    mutations: { retry: false },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe('channel tag query rollout', () => {
  it('does not fetch while disabled and hides cached labels when switched off', async () => {
    const [enabled, setEnabled] = createSignal(false);
    mocks.enabled = enabled;
    client.setQueryData(
      channelLabelKeys.list(undefined, 'viewer').queryKey,
      labels
    );
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
      queryKey: channelLabelKeys.list(undefined, 'viewer').queryKey,
    });
    expect(mocks.list).not.toHaveBeenCalled();

    setEnabled(true);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(data()).toEqual(labels.labels));

    setEnabled(false);
    await waitFor(() => expect(query.isEnabled).toBe(false));
    expect(data()).toBeUndefined();
    await client.invalidateQueries({
      queryKey: channelLabelKeys.list(undefined, 'viewer').queryKey,
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(
      client.getQueryData(channelLabelKeys.list(undefined, 'viewer').queryKey)
    ).toEqual(labels);
  });

  it('keeps personal and team list caches independent', async () => {
    mocks.enabled = () => true;
    const Probe = () => {
      useChannelLabelsQuery('personal');
      useChannelLabelsQuery('team');
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.list).toHaveBeenCalledWith('personal');
    expect(mocks.list).toHaveBeenCalledWith('team');
    expect(channelLabelKeys.list('personal').queryKey).not.toEqual(
      channelLabelKeys.list('team').queryKey
    );
  });

  it('gates the extra personal query without disabling the original label rollout', async () => {
    mocks.enabled = () => true;
    const [sectionsEnabled, setSectionsEnabled] = createSignal(false);
    let personal!: ReturnType<typeof useChannelLabelsQuery>;
    const Probe = () => {
      useChannelLabelsQuery();
      personal = useChannelLabelsQuery('personal', sectionsEnabled);
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledExactlyOnceWith(undefined)
    );
    expect(personal.isEnabled).toBe(false);
    setSectionsEnabled(true);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('personal'));
    setSectionsEnabled(false);
    await waitFor(() => expect(personal.isEnabled).toBe(false));
    await client.invalidateQueries({
      queryKey: channelLabelKeys.list('personal', 'viewer').queryKey,
    });
    expect(
      mocks.list.mock.calls.filter(([scope]) => scope === 'personal')
    ).toHaveLength(1);
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
  it('does not publish late reads into another account', async () => {
    const [userId, setUserId] = createSignal('viewer');
    mocks.userId = userId;
    mocks.enabled = () => true;
    let finish!: (result: Ok<ChannelLabelsList, never>) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const otherLabels = { ...labels, labels: [] };
    mocks.list.mockResolvedValueOnce(ok(otherLabels));
    let data!: ReturnType<typeof useChannelLabelsData>;
    const Probe = () => {
      data = useChannelLabelsData('personal');
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    setUserId('new-viewer');
    await waitFor(() => expect(data()).toEqual([]));
    finish(ok(labels));
    await waitFor(() =>
      expect(
        client.getQueryData(
          channelLabelKeys.list('personal', 'viewer').queryKey
        )
      ).toEqual(labels)
    );
    expect(data()).toEqual([]);
  });

  it('rejects queued assignments after an account change', async () => {
    const [userId, setUserId] = createSignal('viewer');
    mocks.userId = userId;
    let finish!: (result: Ok<void, never>) => void;
    mocks.assign.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    let assign!: ReturnType<typeof useSetChannelLabelMutation>;
    const Probe = () => {
      assign = useSetChannelLabelMutation('personal');
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    const first = assign.mutateAsync({
      actorId: 'viewer',
      channelId: 'channel-1',
      labelId: 'section-1',
    });
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(1));
    const second = catchToResult(() =>
      assign.mutateAsync({
        actorId: 'viewer',
        channelId: 'channel-2',
        labelId: 'section-2',
      })
    );
    setUserId('new-viewer');
    finish(ok(undefined));
    await first;
    expect((await second).isErr()).toBe(true);
    expect(mocks.assign).toHaveBeenCalledTimes(1);
  });
});
