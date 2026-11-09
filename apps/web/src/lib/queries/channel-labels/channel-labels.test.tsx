import { catchToResult } from '@core/util/result';
import type { ChannelLabelScopeSelection } from '@service-storage/generated/schemas/channelLabelScopeSelection';
import type { ChannelLabelsList } from '@service-storage/generated/schemas/channelLabelsList';
import type { SmartTagPreview } from '@service-storage/generated/schemas/smartTagPreview';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  focusManager,
  type QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { channelKeys } from '../channel/keys';
import { queryClient } from '../client';
import {
  useAvailableSectionChannelsQuery,
  useChannelLabelsData,
  useChannelLabelsQuery,
  useRenameChannelLabelMutation,
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
  rename: vi.fn(),
  channels: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      flag.key === 'enable-chat-sidebar-sections' ? false : mocks.enabled(),
  }),
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
      rename: mocks.rename,
    },
  },
}));
vi.mock('../channel/channels', () => ({ fetchAllChannels: mocks.channels }));
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
  mocks.rename.mockReset();
  mocks.channels.mockReset().mockResolvedValue([]);
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
  focusManager.setFocused(undefined);
});

describe('channel tag query rollout', () => {
  it('isolates available channels by account and follows channel-list invalidation', async () => {
    mocks.enabled = () => true;
    const [userId, setUserId] = createSignal('viewer');
    mocks.userId = userId;
    let finishOld!: (channels: { id: string }[]) => void;
    mocks.channels.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    );
    mocks.channels.mockResolvedValueOnce([{ id: 'current' }]);
    let query!: ReturnType<typeof useAvailableSectionChannelsQuery>;
    const Probe = () => {
      query = useAvailableSectionChannelsQuery();
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(mocks.channels).toHaveBeenCalledTimes(1));
    setUserId('new-viewer');
    await waitFor(() => expect(query.isPending).toBe(false));
    expect(query.data?.map((channel) => channel.id)).toEqual(['current']);
    finishOld([{ id: 'old-account' }]);
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(query.data?.map((channel) => channel.id)).toEqual(['current']);

    mocks.channels.mockResolvedValueOnce([{ id: 'joined' }]);
    await client.invalidateQueries({
      queryKey: channelKeys.listChannels.queryKey,
    });
    expect(query.data?.map((channel) => channel.id)).toEqual(['joined']);
  });

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

  it('inherits bounded retries for transient section failures and retains cached labels', async () => {
    mocks.enabled = () => true;
    client.setDefaultOptions({ queries: { retry: 1, retryDelay: 0 } });
    client.setQueryData(
      channelLabelKeys.list('personal', 'viewer').queryKey,
      labels
    );
    mocks.list.mockRejectedValueOnce(new Error('Network unavailable'));
    mocks.list.mockResolvedValueOnce(ok(labels));
    let data!: ReturnType<typeof useChannelLabelsData>;
    let query!: ReturnType<typeof useChannelLabelsQuery>;
    const Probe = () => {
      data = useChannelLabelsData('personal');
      query = useChannelLabelsQuery('personal');
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));

    expect(data()).toEqual(labels.labels);
    await client.invalidateQueries({
      queryKey: channelLabelKeys.list('personal', 'viewer').queryKey,
    });

    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(query.isError).toBe(false);
    expect(data()).toEqual(labels.labels);
  });

  it('recovers an initial section failure when the app regains focus', async () => {
    mocks.enabled = () => true;
    client.setDefaultOptions({
      queries: { retry: false, refetchOnWindowFocus: false },
    });
    mocks.list.mockRejectedValueOnce(new Error('Network unavailable'));
    mocks.list.mockResolvedValueOnce(ok(labels));
    let query!: ReturnType<typeof useChannelLabelsQuery>;
    const Probe = () => {
      query = useChannelLabelsQuery('personal');
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(query.isError).toBe(true));

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => expect(query.isSuccess).toBe(true));
    expect(query.data?.labels).toEqual(labels.labels);
    expect(mocks.list).toHaveBeenCalledTimes(2);
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
  it('switches smart preview scope without remounting and ignores the old scope response', async () => {
    mocks.enabled = () => true;
    const [scope, setScope] =
      createSignal<ChannelLabelScopeSelection>('personal');
    let finishPersonal!: (value: Ok<SmartTagPreview, never>) => void;
    mocks.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPersonal = resolve;
        })
    );
    mocks.preview.mockResolvedValueOnce(
      ok({
        channels: [{ id: 'team-channel', name: 'Team channel' }],
        totalCount: 1,
      })
    );
    let preview!: ReturnType<typeof useSmartTagPreviewQuery>;
    const Probe = () => {
      preview = useSmartTagPreviewQuery(() => 'channel', scope);
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
    setScope('team');
    await waitFor(() => expect(preview.isPending).toBe(false));
    expect(mocks.preview).toHaveBeenLastCalledWith(
      { attribute: 'name', contains: 'channel' },
      expect.any(AbortSignal),
      'team'
    );
    expect(preview.data?.channels.map((channel) => channel.id)).toEqual([
      'team-channel',
    ]);

    finishPersonal(
      ok({
        channels: [{ id: 'private-channel', name: 'Private channel' }],
        totalCount: 1,
      })
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(preview.data?.channels.map((channel) => channel.id)).toEqual([
      'team-channel',
    ]);
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

  it('moves the same section between caches and reconciles destination assignments', async () => {
    const section = labels.labels[0];
    const moved = { ...section, name: 'Moved', teamId: 'team' };
    const personalKey = channelLabelKeys.list('personal', 'viewer').queryKey;
    const teamKey = channelLabelKeys.list(undefined, 'viewer').queryKey;
    client.setQueryData(personalKey, labels);
    client.setQueryData<ChannelLabelsList>(teamKey, {
      scope: 'team',
      teamId: 'team',
      labels: [
        {
          ...section,
          id: 'existing',
          channelIds: ['channel-1', 'channel-2'],
          channelCount: 2,
        },
      ],
    });
    mocks.rename.mockResolvedValue(ok(moved));
    let rename!: ReturnType<typeof useRenameChannelLabelMutation>;
    const Probe = () => {
      rename = useRenameChannelLabelMutation('personal');
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));

    await rename.mutateAsync({
      actorId: 'viewer',
      labelId: section.id,
      name: 'Moved',
      targetScope: 'team',
    });

    expect(mocks.rename).toHaveBeenCalledWith(
      section.id,
      { name: 'Moved', rule: undefined, targetScope: 'team' },
      'personal'
    );
    expect(client.getQueryData<ChannelLabelsList>(personalKey)?.labels).toEqual(
      []
    );
    expect(client.getQueryData<ChannelLabelsList>(teamKey)?.labels).toEqual([
      {
        ...section,
        id: 'existing',
        channelIds: ['channel-2'],
        channelCount: 1,
      },
      moved,
    ]);
  });

  it('does not publish a scope change after the acting account changes', async () => {
    const [userId, setUserId] = createSignal('viewer');
    mocks.userId = userId;
    const section = labels.labels[0];
    const personalKey = channelLabelKeys.list('personal', 'viewer').queryKey;
    const teamKey = channelLabelKeys.list(undefined, 'viewer').queryKey;
    client.setQueryData(personalKey, labels);
    client.setQueryData(teamKey, { scope: 'team', teamId: 'team', labels: [] });
    let finish!: (result: Ok<typeof section, never>) => void;
    mocks.rename.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    let rename!: ReturnType<typeof useRenameChannelLabelMutation>;
    const Probe = () => {
      rename = useRenameChannelLabelMutation('personal');
      return null;
    };
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    const request = rename.mutateAsync({
      actorId: 'viewer',
      labelId: section.id,
      name: section.name,
      targetScope: 'team',
    });
    await waitFor(() => expect(mocks.rename).toHaveBeenCalledTimes(1));
    setUserId('another-viewer');
    finish(ok({ ...section, teamId: 'team' }));
    await request;

    expect(client.getQueryData<ChannelLabelsList>(personalKey)).toEqual(labels);
    expect(client.getQueryData<ChannelLabelsList>(teamKey)?.labels).toEqual([]);
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
