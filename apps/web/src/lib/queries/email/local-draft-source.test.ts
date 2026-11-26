import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  list: vi.fn<() => Promise<LocalDraft[]>>(),
  listeners: new Set<() => void>(),
}));
vi.mock('./local-drafts', () => ({
  listLocalDrafts: runtime.list,
  localDraftStore: {
    subscribe(listener: () => void) {
      runtime.listeners.add(listener);
      return () => runtime.listeners.delete(listener);
    },
  },
}));
vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

import { QueryObserver } from '@tanstack/solid-query';
import { authKeys } from '../auth/keys';
import { queryClient } from '../client';
import {
  createLocalDraftSource,
  localDraftEntities,
  localDraftMatchesFilters,
} from './local-draft-source';

const draft = (overrides: Partial<LocalDraft> = {}): LocalDraft => ({
  key: 'handle',
  draftId: 'handle',
  threadId: 'thread',
  accountId: 'owner',
  generation: 'generation',
  revision: 2,
  acknowledgedRevision: 1,
  content: { subject: 'Recover me' },
  attachments: [],
  status: 'failed',
  updatedAt: 1,
  ...overrides,
});

const signIn = (id: string, updatedAt?: number) =>
  queryClient.setQueryData(
    authKeys.userInfo.queryKey,
    { authenticated: true, id },
    { updatedAt }
  );

/** One tick for the deferred refresh, one for the listing it awaits. */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  runtime.list.mockReset();
  runtime.listeners.clear();
  queryClient.clear();
});

describe('local draft discovery', () => {
  it('never reads view state synchronously from a notification, and skips refreshes once disposed', async () => {
    runtime.list.mockResolvedValue([]);
    const enabled = vi.fn(() => true);
    const dispose = createRoot((dispose) => {
      createLocalDraftSource(enabled);
      return dispose;
    });
    await Promise.resolve();
    enabled.mockClear();
    // Query observers are removed, and notify, while Solid disposes the view.
    signIn('owner');
    for (const listener of runtime.listeners) listener();
    expect(enabled).not.toHaveBeenCalled();
    dispose();
    await Promise.resolve();
    expect(enabled).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().hasListeners()).toBe(false);
  });

  it('rereads only when the signed-in account or its confirmation changes', async () => {
    signIn('owner', performance.timeOrigin - 1);
    runtime.list.mockResolvedValue([]);
    const dispose = createRoot((dispose) => {
      createLocalDraftSource(() => true);
      return dispose;
    });
    try {
      await settle();
      expect(runtime.list).toHaveBeenCalledOnce();
      runtime.list.mockClear();

      // Other views observing, refetching, or rewriting the same identity.
      const observer = new QueryObserver(queryClient, {
        queryKey: authKeys.userInfo.queryKey,
        enabled: false,
      });
      const stop = observer.subscribe(() => {});
      stop();
      queryClient.setQueryData(authKeys.userInfo.queryKey, (user) => user, {
        updatedAt: performance.timeOrigin - 1,
      });
      queryClient.setQueryData(authKeys.userQuota.queryKey, {
        unrelated: true,
      });
      await settle();
      expect(runtime.list).not.toHaveBeenCalled();

      // The server confirms the restored identity, which permits a takeover.
      signIn('owner');
      await settle();
      expect(runtime.list).toHaveBeenCalledOnce();
      signIn('owner');
      await settle();
      expect(runtime.list).toHaveBeenCalledOnce();

      signIn('other');
      await settle();
      expect(runtime.list).toHaveBeenCalledTimes(2);

      queryClient.setQueryData(authKeys.userInfo.queryKey, {
        authenticated: false,
      });
      await settle();
      expect(runtime.list).toHaveBeenCalledTimes(3);

      // Removing a signed-out identity changes nothing; removing a signed-in one does.
      queryClient.removeQueries({ queryKey: authKeys.userInfo.queryKey });
      await settle();
      expect(runtime.list).toHaveBeenCalledTimes(3);
      signIn('owner');
      await settle();
      expect(runtime.list).toHaveBeenCalledTimes(4);
      queryClient.removeQueries({ queryKey: authKeys.userInfo.queryKey });
      await settle();
      expect(runtime.list).toHaveBeenCalledTimes(5);
    } finally {
      dispose();
    }
  });

  it('retries a failed listing on the next user-info event until it succeeds', async () => {
    signIn('owner');
    runtime.list.mockRejectedValueOnce(new Error('storage unavailable'));
    const state = createRoot((dispose) => ({
      source: createLocalDraftSource(() => true),
      dispose,
    }));
    const observe = () =>
      new QueryObserver(queryClient, {
        queryKey: authKeys.userInfo.queryKey,
        enabled: false,
      }).subscribe(() => {})();
    try {
      await settle();
      expect(state.source.drafts()).toEqual([]);
      runtime.list.mockResolvedValue([draft()]);
      observe();
      await settle();
      expect(state.source.drafts()).toHaveLength(1);
      expect(runtime.list).toHaveBeenCalledTimes(2);
      observe();
      await settle();
      expect(runtime.list).toHaveBeenCalledTimes(2);
    } finally {
      state.dispose();
    }
  });

  it('does not touch draft storage in REST mode and ignores a late result after disabling', async () => {
    let resolve!: (drafts: LocalDraft[]) => void;
    runtime.list.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const state = createRoot((dispose) => {
      const [enabled, setEnabled] = createSignal(false);
      return { source: createLocalDraftSource(enabled), setEnabled, dispose };
    });
    try {
      expect(runtime.list).not.toHaveBeenCalled();
      state.setEnabled(true);
      expect(runtime.list).toHaveBeenCalledOnce();
      state.setEnabled(false);
      resolve([draft()]);
      await Promise.resolve();
      expect(state.source.drafts()).toEqual([]);
      expect(state.source.ready()).toBe(true);
    } finally {
      state.dispose();
    }
    expect(runtime.listeners.size).toBe(0);
  });

  it('refreshes recoverable drafts after a cross-tab invalidation', async () => {
    runtime.list.mockResolvedValue([]);
    const state = createRoot((dispose) => ({
      source: createLocalDraftSource(() => true),
      dispose,
    }));
    try {
      await Promise.resolve();
      expect(state.source.drafts()).toEqual([]);
      runtime.list.mockResolvedValue([draft()]);
      for (const listener of runtime.listeners) listener();
      await settle();
      expect(state.source.drafts()[0].content.subject).toBe('Recover me');
    } finally {
      state.dispose();
    }
  });

  it('emits one canonical conversation row and excludes synced or deleting copies', () => {
    const rows = localDraftEntities([
      draft({ serverThreadId: 'canonical' }),
      draft({ key: 'reply', serverThreadId: 'canonical' }),
      draft({ key: 'synced', threadId: 'synced', status: 'synced' }),
      draft({
        key: 'deleting',
        threadId: 'deleting',
        status: 'deleting',
        latestAttemptId: 'delete',
        queuedAttemptId: 'delete',
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'canonical',
      isDraft: true,
      name: 'Recover me',
    });
  });

  it('respects selected inboxes, senders, date ranges, and server-only email views', () => {
    const local = draft({
      inboxId: 'personal',
      senderEmail: 'me@example.com',
      updatedAt: Date.parse('2026-10-01'),
    });
    expect(
      localDraftMatchesFilters(local, {
        emailView: 'drafts',
        include: { emailLinkId: ['personal'] },
        exclude: {},
      })
    ).toBe(true);
    expect(
      localDraftMatchesFilters(local, {
        include: { emailLinkId: ['work'] },
        exclude: {},
      })
    ).toBe(false);
    expect(
      localDraftMatchesFilters(local, {
        include: {},
        exclude: { emailSender: ['me@example.com'] },
      })
    ).toBe(false);
    expect(
      localDraftMatchesFilters(local, {
        include: { emailUpdatedAt: { lt: '2026-09-01' } },
        exclude: {},
      })
    ).toBe(false);
    expect(
      localDraftMatchesFilters(local, {
        emailView: 'sent',
        include: {},
        exclude: {},
      })
    ).toBe(false);
    expect(
      localDraftMatchesFilters(local, {
        include: { emailCalendarOnly: true },
        exclude: {},
      })
    ).toBe(false);
  });
});
