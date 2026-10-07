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
  const discard = vi.fn(async () => {});
  const status = createRoot((dispose) => {
    disposers.push(dispose);
    return createDraftSyncStatus({
      drafts: context.drafts,
      draftId: () => 'draft',
      localSaveState: () => 'saved',
      acknowledgeSaved: () => true,
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
      acknowledgeSaved: () => true,
      retry: vi.fn(),
      discard: vi.fn(),
    });
  });
  await vi.waitFor(() =>
    expect(status.state()?.message).toBe('Unable to read local draft status.')
  );
  expect(status.state()?.failed).toBe(true);
});

it('acknowledges saved edits only after input pauses and stays stable through background sync', async () => {
  const context = createComposeContext();
  const [local, setLocal] = createSignal<LocalDraft | undefined>();
  const [disk, setDisk] = createSignal<'saving' | 'saved' | 'failed'>('saving');
  const [inputIdle, setInputIdle] = createSignal(false);
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
      acknowledgeSaved: inputIdle,
      retry,
      discard: vi.fn(),
    });
  });
  await vi.waitFor(() => expect(context.drafts.readDraft).toHaveBeenCalled());
  expect(status.state()).toBeUndefined();
  for (const phase of [
    'dirty',
    'queued',
    'synced',
    'dirty',
    'queued',
    'synced',
  ] as const) {
    setLocal({ ...draft, status: phase });
    changed();
    setDisk('saved');
    await vi.waitFor(() => expect(status.state()?.message).toBe('Draft saved'));
    expect(status.state()?.savedVersion).toBeUndefined();
    setInputIdle(true);
    const version = status.state()?.savedVersion;
    expect(version).toBe('generation:1');
    changed();
    await vi.waitFor(() => expect(status.state()?.savedVersion).toBe(version));
    setDisk('saving');
    expect(status.state()?.savedVersion).toBeUndefined();
    setDisk('saved');
    expect(status.state()?.savedVersion).toBe(version);
    setInputIdle(false);
    expect(status.state()?.savedVersion).toBeUndefined();
    setDisk('saving');
    expect(status.state()).toMatchObject({
      message: 'Draft saved',
      failed: false,
    });
    expect(status.state()?.action).toBeUndefined();
  }
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
      acknowledgeSaved: () => false,
      retry: vi.fn(),
      discard: vi.fn(),
    });
  });
  await vi.waitFor(() =>
    expect(status.state()).toMatchObject({ failed: true, action: 'retry' })
  );
});
