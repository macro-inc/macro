import { renderHook } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mutations read the app-wide query client and call service client;
// swap in an isolated client and a stub whose saves resolve on demand.
const saves = vi.hoisted(() => ({
  pending: [] as {
    body: unknown;
    resolve: (result: unknown) => void;
  }[],
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-call/client', () => ({
  callServiceClient: {
    updateCallSettings: (body: unknown) =>
      new Promise((resolve) => saves.pending.push({ body, resolve })),
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

import { queryClient } from '@queries/client';
import type { CallSettings } from '@service-call/client';
import { ok } from 'neverthrow';
import { useUpdateCallSettingsMutation } from './call-settings';
import { callKeys } from './keys';

const SETTINGS: CallSettings = {
  recordByDefault: {
    huddles: true,
    oneOnOnes: true,
    internalMeetings: true,
    externalMeetings: true,
  },
  shareByDefault: {
    huddles: 'channel',
    oneOnOnes: 'participants',
    internalMeetings: 'invited',
    externalMeetings: 'team',
  },
  refuseOneOnOneRecording: false,
  team: null,
};

const cached = () =>
  queryClient.getQueryData<CallSettings>(callKeys.settings.queryKey);

function useMutation() {
  const wrapper = (props: { children: JSX.Element }) => (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  );
  return renderHook(useUpdateCallSettingsMutation, { wrapper }).result;
}

describe('call settings mutations', () => {
  beforeEach(() => {
    queryClient.clear();
    saves.pending = [];
    queryClient.setQueryData(callKeys.settings.queryKey, SETTINGS);
  });

  it('keeps a later change when an earlier save answers first', async () => {
    const update = useMutation();
    update.mutate({ recordByDefault: { huddles: false } });
    await vi.waitFor(() => expect(saves.pending).toHaveLength(1));
    update.mutate({ shareByDefault: { internalMeetings: 'team' } });
    await vi.waitFor(() => expect(saves.pending).toHaveLength(2));

    // The first save's snapshot predates the second change.
    saves.pending[0].resolve(
      ok({
        ...SETTINGS,
        recordByDefault: { ...SETTINGS.recordByDefault, huddles: false },
      })
    );
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(1));
    expect(cached()?.shareByDefault.internalMeetings).toBe('team');
    expect(cached()?.recordByDefault.huddles).toBe(false);

    // The last save's snapshot is applied.
    const stored: CallSettings = {
      ...SETTINGS,
      recordByDefault: { ...SETTINGS.recordByDefault, huddles: false },
      shareByDefault: { ...SETTINGS.shareByDefault, internalMeetings: 'team' },
    };
    saves.pending[1].resolve(ok(stored));
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(cached()).toEqual(stored);
  });
});
