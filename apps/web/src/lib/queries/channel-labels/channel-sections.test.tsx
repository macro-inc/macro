import type { ChannelLabelsList } from '@service-storage/generated/schemas/channelLabelsList';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import {
  useChannelLabelsQuery,
  useRenameChannelLabelMutation,
  useSetChannelLabelMutation,
  useSmartTagPreviewQuery,
} from './channel-labels';
import { channelLabelKeys, channelSectionKeys } from './keys';

const mocks = vi.hoisted(() => ({
  sections: (): boolean => true,
  list: vi.fn(),
  sectionList: vi.fn(),
  assign: vi.fn(),
  sectionAssign: vi.fn(),
  rename: vi.fn(),
  sectionRename: vi.fn(),
  preview: vi.fn(),
  sectionPreview: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      flag.key === 'enable-chat-sidebar-sections' ? mocks.sections() : true,
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    channelLabels: {
      list: mocks.list,
      setChannelLabel: mocks.assign,
      rename: mocks.rename,
      preview: mocks.preview,
    },
    channelSections: {
      list: mocks.sectionList,
      setChannelLabel: mocks.sectionAssign,
      rename: mocks.sectionRename,
      preview: mocks.sectionPreview,
    },
  },
}));
vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
const legacy: ChannelLabelsList = {
  scope: 'personal',
  labels: [
    {
      id: 'section',
      name: 'Release',
      channelIds: ['match'],
      channelCount: 1,
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
      rule: { attribute: 'name', contains: 'release' },
    },
  ],
};
const sections: ChannelLabelsList = {
  ...legacy,
  labels: [
    {
      ...legacy.labels[0],
      channelIds: ['match', 'picked'],
      explicitChannelIds: ['picked'],
      channelCount: 2,
    },
  ],
};
beforeEach(() => {
  mocks.sections = () => true;
  for (const mock of [
    mocks.list,
    mocks.sectionList,
    mocks.assign,
    mocks.sectionAssign,
    mocks.rename,
    mocks.sectionRename,
    mocks.preview,
    mocks.sectionPreview,
  ])
    mock.mockReset();
  mocks.list.mockResolvedValue(ok(legacy));
  mocks.sectionList.mockResolvedValue(ok(sections));
  mocks.sectionAssign.mockResolvedValue(ok(undefined));
  mocks.sectionPreview.mockResolvedValue(
    ok({
      channels: [{ id: 'unjoined', name: 'Release', isParticipant: false }],
      totalCount: 1,
    })
  );
  queryClient.setDefaultOptions({
    queries: { retry: false },
    mutations: { retry: false },
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

it('keeps legacy and section snapshots isolated while the rollout changes', async () => {
  const [enabled, setEnabled] = createSignal(false);
  mocks.sections = enabled;
  queryClient.setQueryData(
    channelLabelKeys.list('personal', 'viewer').queryKey,
    legacy
  );
  queryClient.setQueryData(
    channelSectionKeys.list('personal', 'viewer').queryKey,
    sections
  );
  let query!: ReturnType<typeof useChannelLabelsQuery>;
  const Probe = () => {
    query = useChannelLabelsQuery('personal');
    return null;
  };
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  ));
  expect(query.data).toEqual(legacy);
  setEnabled(true);
  await waitFor(() => expect(query.data).toEqual(sections));
  await query.refetch();
  expect(mocks.sectionList).toHaveBeenCalledExactlyOnceWith('personal');
  expect(mocks.list).not.toHaveBeenCalled();
  setEnabled(false);
  await waitFor(() => expect(query.data).toEqual(legacy));
  await query.refetch();
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith('personal');
  expect(
    queryClient.getQueryData(
      channelSectionKeys.list('personal', 'viewer').queryKey
    )
  ).toEqual(sections);
});

it('finishes a section assignment against its captured API and refetches the union after a flag change', async () => {
  const [enabled, setEnabled] = createSignal(true);
  mocks.sections = enabled;
  let finish!: (result: Ok<void, never>) => void;
  mocks.sectionAssign.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let query!: ReturnType<typeof useChannelLabelsQuery>;
  let assign!: ReturnType<typeof useSetChannelLabelMutation>;
  const Probe = () => {
    query = useChannelLabelsQuery('personal');
    assign = useSetChannelLabelMutation('personal');
    return null;
  };
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  ));
  await waitFor(() => expect(query.data).toEqual(sections));
  const pending = assign.mutateAsync({
    actorId: 'viewer',
    channelId: 'another-pick',
    labelId: 'section',
    sectionMode: true,
  });
  await waitFor(() => expect(mocks.sectionAssign).toHaveBeenCalledTimes(1));
  setEnabled(false);
  await waitFor(() => expect(query.data).toEqual(legacy));
  const updated: ChannelLabelsList = {
    ...sections,
    labels: [
      {
        ...sections.labels[0],
        channelIds: ['match', 'picked', 'another-pick'],
        explicitChannelIds: ['picked', 'another-pick'],
        channelCount: 3,
      },
    ],
  };
  mocks.sectionList.mockResolvedValue(ok(updated));
  finish(ok(undefined));
  await pending;
  expect(mocks.assign).not.toHaveBeenCalled();
  expect(
    queryClient.getQueryState(
      channelSectionKeys.list('personal', 'viewer').queryKey
    )?.isInvalidated
  ).toBe(true);
  setEnabled(true);
  await waitFor(() => expect(query.data).toEqual(updated));
  expect(mocks.sectionAssign).toHaveBeenCalledExactlyOnceWith(
    'another-pick',
    { labelId: 'section' },
    'personal'
  );
});

it('refreshes both scopes and both representations after a section transfer', async () => {
  const shared: ChannelLabelsList = {
    scope: 'team',
    teamId: 'team',
    labels: [{ ...sections.labels[0], teamId: 'team' }],
  };
  let transferred = false;
  mocks.sectionList.mockImplementation(async (scope: string) =>
    ok(
      scope === 'personal'
        ? transferred
          ? { scope: 'personal', labels: [] }
          : sections
        : transferred
          ? shared
          : { scope: 'team', teamId: 'team', labels: [] }
    )
  );
  mocks.sectionRename.mockImplementation(async () => {
    transferred = true;
    return ok(shared.labels[0]);
  });
  queryClient.setQueryData(
    channelLabelKeys.list('personal', 'viewer').queryKey,
    legacy
  );
  queryClient.setQueryData(
    channelLabelKeys.list(undefined, 'viewer').queryKey,
    { scope: 'team', teamId: 'team', labels: [] }
  );
  let personal!: ReturnType<typeof useChannelLabelsQuery>;
  let team!: ReturnType<typeof useChannelLabelsQuery>;
  let rename!: ReturnType<typeof useRenameChannelLabelMutation>;
  const Probe = () => {
    personal = useChannelLabelsQuery('personal');
    team = useChannelLabelsQuery();
    rename = useRenameChannelLabelMutation('personal');
    return null;
  };
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  ));
  await waitFor(() => expect(personal.data?.labels).toHaveLength(1));
  await waitFor(() => expect(team.data?.labels).toHaveLength(0));
  await rename.mutateAsync({
    actorId: 'viewer',
    labelId: 'section',
    name: 'Release',
    targetScope: 'team',
    sectionMode: true,
  });
  expect(personal.data?.labels).toEqual([]);
  expect(team.data).toEqual(shared);
  expect(mocks.rename).not.toHaveBeenCalled();
  for (const scope of ['personal', undefined] as const) {
    expect(
      queryClient.getQueryState(channelLabelKeys.list(scope, 'viewer').queryKey)
        ?.isInvalidated
    ).toBe(true);
  }
});

it('uses the additive preview without leaking a cached joined-only preview', async () => {
  queryClient.setQueryData(
    channelLabelKeys.preview('release', 'team', 'viewer').queryKey,
    { channels: [], totalCount: 0 }
  );
  let preview!: ReturnType<typeof useSmartTagPreviewQuery>;
  const Probe = () => {
    preview = useSmartTagPreviewQuery(() => 'release', 'team');
    return null;
  };
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  ));
  await waitFor(() =>
    expect(preview.data?.channels[0]?.isParticipant).toBe(false)
  );
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.sectionPreview).toHaveBeenCalledTimes(1);
});
