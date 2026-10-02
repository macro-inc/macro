import { createRoot } from 'solid-js';
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
