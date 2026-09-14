import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PersistedEmailIdentity } from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';

const response: PersistedEmailIdentity = {
  draftId: 'saved-id',
  threadId: 'thread',
  inboxId: 'inbox',
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('flushes the latest pending body and envelope exactly once on disposal', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Last-second edit', 'Launch review');
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  const { draft } = vi.mocked(composeContext.drafts.saveDraft).mock.calls[0][0];
  expect(decodeBase64Utf8(draft.body_html ?? '')).toContain('Last-second edit');
  expect(draft.subject).toBe('Launch review');
  expect(draft.to).toEqual([
    expect.objectContaining({ email: 'colleague@example.com' }),
  ]);
});
it('does not save an untouched composer or repeat a settled autosave on disposal', async () => {
  const composeContext = createComposeContext();
  const untouched = mountEmailComposer(composeContext);
  untouched.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).not.toHaveBeenCalled();
  const edited = mountEmailComposer(composeContext);
  edited.edit('Saved');
  await vi.advanceTimersByTimeAsync(600);
  edited.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
});
it('serializes a disposal flush behind the first save and reuses its returned ID', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(
    pending.promise
  );
  const root = mountEmailComposer(composeContext);
  root.edit('First');
  await vi.advanceTimersByTimeAsync(600);
  root.edit('Latest');
  root.dispose();
  await vi.advanceTimersByTimeAsync(600);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(2);
  const { draft } = vi.mocked(composeContext.drafts.saveDraft).mock.calls[1][0];
  expect(draft.db_id).toBe('saved-id');
  expect(decodeBase64Utf8(draft.body_html ?? '')).toContain('Latest');
});
it('discard cancels an unsaved debounce without creating a draft', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Discard me');
  await root.state.deleteDraftAndReset();
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).not.toHaveBeenCalled();
  expect(composeContext.drafts.deleteDraft).not.toHaveBeenCalled();
});
it('discard waits for an in-flight first save and deletes its returned draft', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(
    pending.promise
  );
  const root = mountEmailComposer(composeContext);
  root.edit('First');
  await vi.advanceTimersByTimeAsync(600);
  root.edit('Discard these changes too');
  const discard = root.state.deleteDraftAndReset();
  root.dispose();
  pending.resolve(response);
  await discard;
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  expect(composeContext.drafts.deleteDraft).toHaveBeenCalledWith(
    expect.objectContaining({ draftId: 'saved-id' })
  );
});
it('keeps the draft editable after failed deletion and saves later edits', async () => {
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Saved');
  await vi.advanceTimersByTimeAsync(600);
  vi.mocked(composeContext.drafts.deleteDraft).mockRejectedValueOnce(
    new Error('offline')
  );
  await expect(root.state.deleteDraftAndReset()).rejects.toThrow('offline');
  root.edit('Still here');
  await vi.advanceTimersByTimeAsync(600);
  root.dispose();
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(2);
});
it('waits for the saved draft ID, prevents duplicate sends, and does not recreate the sent draft on disposal', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(
    pending.promise
  );
  const root = mountEmailComposer(composeContext);
  root.edit('Send this');
  root.state.context.onSend();
  root.state.context.onSend();
  expect(root.state.context.disabled()).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  expect(composeContext.delivery.sendMessage).not.toHaveBeenCalled();
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.delivery.sendMessage).toHaveBeenCalledOnce();
  expect(
    vi.mocked(composeContext.delivery.sendMessage).mock.calls[0][0].message
      .db_id
  ).toBe('saved-id');
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
});
it('resumes autosave after a failed send', async () => {
  const composeContext = createComposeContext();
  vi.mocked(composeContext.delivery.sendMessage).mockRejectedValueOnce(
    new Error('offline')
  );
  const root = mountEmailComposer(composeContext);
  root.edit('Send this');
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(root.state.context.disabled()).toBe(false);
  root.edit('Retry with this');
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(2);
  expect(
    composeContext.notices.feedback.failure
  ).toHaveBeenCalledExactlyOnceWith('Failed to send email');
});

it('keeps a successful send completed when navigation fails', async () => {
  const composeContext = createComposeContext();
  const error = new Error('Navigation failed');
  const root = mountEmailComposer(composeContext, {
    showThread: () => {
      throw error;
    },
  });
  root.edit('Send this');
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.notices.reportError).toHaveBeenCalledWith(error);
  expect(composeContext.notices.feedback.failure).not.toHaveBeenCalled();
  root.state.context.onSend();
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(composeContext.delivery.sendMessage).toHaveBeenCalledOnce();
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
});

it('keeps completion independent when two composers share delivery capabilities', async () => {
  const composeContext = createComposeContext();
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  vi.mocked(composeContext.delivery.sendMessage).mockReturnValueOnce(
    pending.promise
  );
  const first = mountEmailComposer(composeContext);
  const second = mountEmailComposer(composeContext);
  first.edit('First');
  second.edit('Second');
  first.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  second.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.delivery.sendMessage).toHaveBeenCalledTimes(2);
  expect(first.state.context.isSending()).toBe(true);
  expect(second.state.context.isSending()).toBe(false);
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(first.state.context.isSending()).toBe(false);
  first.dispose();
  second.dispose();
});
it('waits for an existing attachment upload before flushing newer body edits', async () => {
  const pending = Promise.withResolvers<void>();
  const composeContext = createComposeContext();
  vi.mocked(
    composeContext.attachmentStorage.uploadAttachments
  ).mockReturnValueOnce(pending.promise);
  const root = mountEmailComposer(composeContext);
  root.edit('With attachment');
  root.state.context.onAddAttachments([
    {
      type: 'local',
      file: new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    },
  ]);
  await vi.advanceTimersByTimeAsync(600);
  root.edit('Final attachment note');
  root.dispose();
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  pending.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledTimes(2);
  expect(
    vi.mocked(composeContext.drafts.saveDraft).mock.calls[1][0].draft.db_id
  ).toBe('draft');
});

it('rejects sender/schedule changes and repeated discard while a deletion is pending', async () => {
  const pending = Promise.withResolvers<void>();
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  root.edit('Saved');
  await vi.advanceTimersByTimeAsync(600);
  vi.mocked(composeContext.drafts.deleteDraft).mockReturnValueOnce(
    pending.promise
  );
  const discard = root.state.deleteDraftAndReset();
  expect(await root.state.deleteDraftAndReset()).toBe(false);
  root.state.context.onSelectInbox?.('other-inbox');
  await root.state.context.onSendTimeChange?.(new Date('2026-12-01T12:00:00Z'));
  expect(root.state.context.selectedInboxId?.()).toBe('inbox');
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
  pending.resolve();
  expect(await discard).toBe(true);
  root.dispose();
});

it('rejects sender and scheduling changes after send dispatch', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  const root = mountEmailComposer(composeContext);
  vi.mocked(composeContext.delivery.sendMessage).mockReturnValueOnce(
    pending.promise
  );
  root.edit('Send this');
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  root.state.context.onSelectInbox?.('other-inbox');
  await root.state.context.onSendTimeChange?.(new Date('2026-12-01T12:00:00Z'));
  expect(composeContext.drafts.saveDraft).toHaveBeenCalledOnce();
  expect(composeContext.delivery.schedule).not.toHaveBeenCalled();
  expect(root.state.context.selectedInboxId?.()).toBe('inbox');
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  root.dispose();
});

it('uses the captured inbox for attachment upload when a sender switch queues behind a save', async () => {
  const pending = Promise.withResolvers<PersistedEmailIdentity>();
  const composeContext = createComposeContext();
  composeContext.accounts = {
    ...composeContext.accounts,
    inboxes: () => [
      { id: 'inbox', email_address: 'me@example.com', settings: {} },
      { id: 'other', email_address: 'other@example.com', settings: {} },
    ],
  };
  vi.mocked(composeContext.drafts.saveDraft).mockReturnValueOnce(
    pending.promise
  );
  const root = mountEmailComposer(composeContext);
  root.edit('With files');
  root.state.context.onAddAttachments([
    { type: 'local', file: new File(['notes'], 'notes.txt') },
  ]);
  await vi.advanceTimersByTimeAsync(600);
  root.state.context.onSelectInbox?.('other');
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(
    vi.mocked(composeContext.attachmentStorage.uploadAttachments).mock
      .calls[0][0].inboxId
  ).toBe('inbox');
  expect(
    vi.mocked(composeContext.drafts.saveDraft).mock.calls[1][0].inboxId
  ).toBe('other');
  root.dispose();
});
