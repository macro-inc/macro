import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { LocalDraft } from '../core/local-draft';
import { createComposeContext } from '../tests/capabilities';
import { createDraftSyncStatus } from './draft-sync-status';

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});
const draft: LocalDraft = {
  key: 'draft',
  accountId: 'owner',
  generation: 'generation',
  draftId: 'draft',
  revision: 1,
  acknowledgedRevision: 0,
  content: { subject: 'Keep this' },
  attachments: [],
  status: 'delete-failed',
  updatedAt: 1,
  latestAttemptId: 'delete',
  queuedAttemptId: 'delete',
};

it('reports a failed discard, not one still on its way to the server', async () => {
  const context = createComposeContext();
  const [local, setLocal] = createSignal(draft);
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
  const recover = vi.fn(async () => {});
  context.drafts.recoverSynchronization = recover;
  const discard = vi.fn(async () => {
    expect(recover).toHaveBeenCalledOnce();
    // The retried delete waits for the queue to admit it.
    setLocal({ ...draft, status: 'deleting', queuedAttemptId: undefined });
    changed();
  });
  const status = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftSyncStatus({
      drafts: context.drafts,
      connectivity: context.connectivity,
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
  await vi.waitFor(() => expect(status.state()).toBeUndefined());
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
      connectivity: context.connectivity,
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
      connectivity: context.connectivity,
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
      connectivity: context.connectivity,
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

function restartingStatus(local: LocalDraft) {
  const context = createComposeContext();
  const [availability, setAvailability] = createSignal<
    'unavailable' | 'recovering' | 'recovery-required' | 'ready'
  >('unavailable');
  context.drafts.syncAvailability = availability;
  context.drafts.saveLocalDraft = vi.fn();
  context.drafts.readDraft = vi.fn(async () => ({
    local,
    persistence: 'queued' as const,
  }));
  const status = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftSyncStatus({
      drafts: context.drafts,
      connectivity: context.connectivity,
      draftId: () => 'draft',
      localSaveState: () => 'saved',
      retry: vi.fn(),
      discard: vi.fn(),
    });
  });
  return { status, setAvailability, readDraft: context.drafts.readDraft };
}

it('says nothing while local storage restarts, and waits quietly once it stalls', async () => {
  vi.useFakeTimers();
  const { status, setAvailability, readDraft } = restartingStatus({
    ...draft,
    status: 'dirty',
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(readDraft).toHaveBeenCalled();
  expect(status.state()).toBeUndefined();

  // Each automatic attempt passes through both states.
  await vi.advanceTimersByTimeAsync(10_000);
  setAvailability('recovering');
  await vi.advanceTimersByTimeAsync(4_000);
  setAvailability('unavailable');
  expect(status.state()).toBeUndefined();

  await vi.advanceTimersByTimeAsync(1_000);
  expect(status.state()).toMatchObject({
    message: 'Saved on this device; waiting to sync',
    failed: false,
    action: 'retry',
  });
  setAvailability('recovering');
  expect(status.state()).toMatchObject({ failed: false, action: undefined });

  setAvailability('ready');
  expect(status.state()).toBeUndefined();
  // A later restart starts its own wait.
  setAvailability('unavailable');
  await vi.advanceTimersByTimeAsync(14_000);
  expect(status.state()).toBeUndefined();
});

it('asks for a reload as soon as local storage cannot restart by itself', async () => {
  vi.useFakeTimers();
  const { status, setAvailability } = restartingStatus({
    ...draft,
    status: 'dirty',
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(status.state()).toBeUndefined();
  setAvailability('recovery-required');
  expect(status.state()).toMatchObject({ failed: true, action: 'reload' });
});

it('has nothing to report about a stalled restart once the server has every edit', async () => {
  vi.useFakeTimers();
  const { status } = restartingStatus({
    ...draft,
    status: 'synced',
    acknowledgedRevision: 1,
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(status.state()).toBeUndefined();
});
