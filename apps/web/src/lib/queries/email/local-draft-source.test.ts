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
vi.mock('../client', () => ({
  queryClient: { getQueryCache: () => ({ subscribe: () => () => {} }) },
}));

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

beforeEach(() => {
  runtime.list.mockReset();
  runtime.listeners.clear();
});

describe('local draft discovery', () => {
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
      await Promise.resolve();
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
