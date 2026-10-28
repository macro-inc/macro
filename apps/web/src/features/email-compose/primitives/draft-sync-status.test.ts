import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { LocalDraft } from '../core/local-draft';
import { createComposeContext } from '../tests/capabilities';
import { createDraftSyncStatus } from './draft-sync-status';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
const draft: LocalDraft = {
  key: 'draft',
  accountId: 'owner',
  generation: 'generation',
  draftId: 'draft',
  revision: 1,
  acknowledgedRevision: 0,
  content: { subject: 'Keep this' },
  attachments: [],
  status: 'deleting',
  updatedAt: 1,
  latestAttemptId: 'delete',
  queuedAttemptId: 'old-save',
};

it('offers retry discard when a crash interrupted deletion before admission', async () => {
  const context = createComposeContext();
  context.drafts.saveLocalDraft = vi.fn();
  context.drafts.readDraft = vi.fn(async () => ({
    local: draft,
    persistence: 'queued' as const,
  }));
  const recover = vi.fn(async () => {});
  context.drafts.recoverSynchronization = recover;
  const discard = vi.fn(async () => {
    expect(recover).toHaveBeenCalledOnce();
  });
  const status = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftSyncStatus({
      drafts: context.drafts,
      draftId: () => 'draft',
      localSaveState: () => 'saved',
      retry: vi.fn(),
      discard,
    });
  });
  expect(status.state()).toBeUndefined();
  await vi.waitFor(() => expect(status.state()?.action).toBe('retry-discard'));
  expect(context.drafts.readDraft).toHaveBeenCalledWith('draft', {
    attachments: false,
  });
  status.retry();
  await vi.waitFor(() => expect(discard).toHaveBeenCalledOnce());
});

it('shows a failed status read without throwing into the composer error boundary', async () => {
  const context = createComposeContext();
  context.drafts.saveLocalDraft = vi.fn();
  context.drafts.readDraft = vi.fn(async () => {
    throw new Error('Disk unavailable');
  });
  const status = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftSyncStatus({
      drafts: context.drafts,
      draftId: () => 'draft',
      localSaveState: () => 'saved',
      retry: vi.fn(),
      discard: vi.fn(),
    });
  });
  await vi.waitFor(() =>
    expect(status.state()?.message).toBe('Unable to read local draft status.')
  );
  expect(status.state()?.failed).toBe(true);
});

it('stays silent once a failed save recovers', async () => {
  const context = createComposeContext();
  const [local, setLocal] = createSignal<LocalDraft>({
    ...draft,
    status: 'failed',
  });
  const [disk, setDisk] = createSignal<'saving' | 'saved' | 'failed'>('saved');
  let changed = () => {};
  context.drafts.saveLocalDraft = vi.fn();
  context.drafts.readDraft = vi.fn(async () => ({
    local: local(),
    persistence: 'queued' as const,
  }));
  context.drafts.watchDrafts = (callback) => {
    changed = callback;
    return () => {};
  };
  const retry = vi.fn(async () => {});
  const status = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftSyncStatus({
      drafts: context.drafts,
      draftId: () => 'draft',
      localSaveState: disk,
      retry,
      discard: vi.fn(),
    });
  });
  await vi.waitFor(() =>
    expect(status.state()).toMatchObject({ failed: true, action: 'retry' })
  );
  setLocal({ ...draft, status: 'synced' });
  changed();
  await vi.waitFor(() => expect(status.state()).toBeUndefined());
  setDisk('failed');
  expect(status.state()).toMatchObject({ failed: true, action: 'retry' });
  status.retry();
  await vi.waitFor(() => expect(retry).toHaveBeenCalledOnce());
});

it('offers retry for server failures while newer edits remain saved locally', async () => {
  const context = createComposeContext();
  context.drafts.saveLocalDraft = vi.fn();
  context.drafts.readDraft = vi.fn(async () => ({
    local: { ...draft, status: 'failed' as const },
    persistence: 'queued' as const,
  }));
  const status = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftSyncStatus({
      drafts: context.drafts,
      draftId: () => 'draft',
      localSaveState: () => 'saving',
      retry: vi.fn(),
      discard: vi.fn(),
    });
  });
  await vi.waitFor(() =>
    expect(status.state()).toMatchObject({ failed: true, action: 'retry' })
  );
});

it('keeps local edits visible with an actionable synchronization status during recovery', async () => {
  const context = createComposeContext();
  const [availability, setAvailability] = createSignal<
    'unavailable' | 'recovering' | 'ready'
  >('unavailable');
  context.drafts.syncAvailability = availability;
  context.drafts.saveLocalDraft = vi.fn();
  context.drafts.readDraft = vi.fn(async () => ({
    local: { ...draft, status: 'dirty' as const },
    persistence: 'queued' as const,
  }));
  const status = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftSyncStatus({
      drafts: context.drafts,
      draftId: () => 'draft',
      localSaveState: () => 'saved',
      retry: vi.fn(),
      discard: vi.fn(),
    });
  });
  await vi.waitFor(() =>
    expect(status.state()?.message).toBe(
      'Saved on this device; waiting to sync'
    )
  );
  expect(status.state()?.action).toBe('retry');
  setAvailability('recovering');
  expect(status.state()?.action).toBeUndefined();
  setAvailability('ready');
  expect(status.state()).toBeUndefined();
});
