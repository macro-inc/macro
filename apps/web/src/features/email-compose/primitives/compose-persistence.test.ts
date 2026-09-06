import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  EmailComposeServices,
  SavedEmailDraft,
} from '../context/compose-services';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { composeServices } from '../tests/services';
import { createEmailComposer } from './email-composer';

function mount(services: EmailComposeServices) {
  const root = createRoot((dispose) => ({
    dispose,
    state: createEmailComposer({ services, initialTo: ['maya@example.com'] }),
  }));
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  root.state.context.captureEditor(editor);
  root.state.context.onContentChange('');
  return {
    ...root,
    edit(text: string) {
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append($createParagraphNode().append($createTextNode(text)));
        },
        { discrete: true }
      );
      root.state.context.setSubject('Launch review');
      root.state.context.onContentChange(text);
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const response: { draft: SavedEmailDraft } = {
  draft: { db_id: 'saved-id', thread_db_id: 'thread', link_id: 'inbox' },
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('flushes the latest pending body and envelope exactly once on disposal', async () => {
  const services = composeServices();
  const root = mount(services);
  root.edit('Last-second edit');
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(services.saveDraft).toHaveBeenCalledOnce();
  const { draft } = vi.mocked(services.saveDraft).mock.calls[0][0];
  expect(decodeBase64Utf8(draft.body_html ?? '')).toContain('Last-second edit');
  expect(draft.subject).toBe('Launch review');
  expect(draft.to).toEqual([
    expect.objectContaining({ email: 'maya@example.com' }),
  ]);
});
it('does not save an untouched composer or repeat a settled autosave on disposal', async () => {
  const services = composeServices();
  const untouched = mount(services);
  untouched.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(services.saveDraft).not.toHaveBeenCalled();
  const edited = mount(services);
  edited.edit('Saved');
  await vi.advanceTimersByTimeAsync(600);
  edited.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(services.saveDraft).toHaveBeenCalledOnce();
});
it('serializes a disposal flush behind the first save and reuses its returned ID', async () => {
  const pending = deferred<{ draft: SavedEmailDraft }>();
  const services = composeServices();
  vi.mocked(services.saveDraft).mockReturnValueOnce(pending.promise);
  const root = mount(services);
  root.edit('First');
  await vi.advanceTimersByTimeAsync(600);
  root.edit('Latest');
  root.dispose();
  await vi.advanceTimersByTimeAsync(600);
  expect(services.saveDraft).toHaveBeenCalledOnce();
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(services.saveDraft).toHaveBeenCalledTimes(2);
  const { draft } = vi.mocked(services.saveDraft).mock.calls[1][0];
  expect(draft.db_id).toBe('saved-id');
  expect(decodeBase64Utf8(draft.body_html ?? '')).toContain('Latest');
});
it('discard cancels an unsaved debounce without creating a draft', async () => {
  const services = composeServices();
  const root = mount(services);
  root.edit('Discard me');
  await root.state.deleteDraftAndReset();
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(services.saveDraft).not.toHaveBeenCalled();
  expect(services.deleteDraft).not.toHaveBeenCalled();
});
it('discard waits for an in-flight first save and deletes its returned draft', async () => {
  const pending = deferred<{ draft: SavedEmailDraft }>();
  const services = composeServices();
  vi.mocked(services.saveDraft).mockReturnValueOnce(pending.promise);
  const root = mount(services);
  root.edit('First');
  await vi.advanceTimersByTimeAsync(600);
  root.edit('Discard these changes too');
  const discard = root.state.deleteDraftAndReset();
  root.dispose();
  pending.resolve(response);
  await discard;
  await vi.advanceTimersByTimeAsync(1000);
  expect(services.saveDraft).toHaveBeenCalledOnce();
  expect(services.deleteDraft).toHaveBeenCalledWith(
    expect.objectContaining({ draftId: 'saved-id' })
  );
});
it('keeps the draft editable after failed deletion and saves later edits', async () => {
  const services = composeServices();
  const root = mount(services);
  root.edit('Saved');
  await vi.advanceTimersByTimeAsync(600);
  vi.mocked(services.deleteDraft).mockRejectedValueOnce(new Error('offline'));
  await expect(root.state.deleteDraftAndReset()).rejects.toThrow('offline');
  root.edit('Still here');
  await vi.advanceTimersByTimeAsync(600);
  root.dispose();
  expect(services.saveDraft).toHaveBeenCalledTimes(2);
});
it('prevents duplicate send during the pre-send save and does not recreate a sent draft on disposal', async () => {
  const pending = deferred<{ draft: SavedEmailDraft }>();
  const services = composeServices();
  vi.mocked(services.saveDraft).mockReturnValueOnce(pending.promise);
  const root = mount(services);
  root.edit('Send this');
  root.state.context.onSend();
  root.state.context.onSend();
  expect(root.state.context.disabled()).toBe(true);
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(services.sendMessage).toHaveBeenCalledOnce();
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(services.saveDraft).toHaveBeenCalledOnce();
});
it('resumes autosave after a failed send', async () => {
  const services = composeServices();
  vi.mocked(services.sendMessage).mockRejectedValueOnce(new Error('offline'));
  const root = mount(services);
  root.edit('Send this');
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  expect(root.state.context.disabled()).toBe(false);
  root.edit('Retry with this');
  root.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(services.saveDraft).toHaveBeenCalledTimes(2);
});
it('waits for an existing attachment upload before flushing newer body edits', async () => {
  const pending = deferred<void>();
  const services = composeServices();
  vi.mocked(services.uploadAttachments).mockReturnValueOnce(pending.promise);
  const root = mount(services);
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
  expect(services.saveDraft).toHaveBeenCalledOnce();
  pending.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(services.saveDraft).toHaveBeenCalledTimes(2);
  expect(vi.mocked(services.saveDraft).mock.calls[1][0].draft.db_id).toBe(
    'draft'
  );
});

it('rejects sender/schedule changes and repeated discard while a deletion is pending', async () => {
  const pending = deferred<void>();
  const services = composeServices();
  const root = mount(services);
  root.edit('Saved');
  await vi.advanceTimersByTimeAsync(600);
  vi.mocked(services.deleteDraft).mockReturnValueOnce(pending.promise);
  const discard = root.state.deleteDraftAndReset();
  expect(await root.state.deleteDraftAndReset()).toBe(false);
  root.state.context.onSelectFromLink?.('other-inbox');
  await root.state.context.onSendTimeChange?.(new Date('2026-12-01T12:00:00Z'));
  expect(root.state.context.selectedFromLinkId?.()).toBe('inbox');
  expect(services.saveDraft).toHaveBeenCalledOnce();
  expect(services.schedule).not.toHaveBeenCalled();
  pending.resolve();
  expect(await discard).toBe(true);
  root.dispose();
});

it('rejects sender and scheduling changes after send dispatch', async () => {
  const pending = deferred<{ message: SavedEmailDraft }>();
  const services = composeServices();
  const root = mount(services);
  vi.mocked(services.sendMessage).mockReturnValueOnce(pending.promise);
  root.edit('Send this');
  root.state.context.onSend();
  await vi.advanceTimersByTimeAsync(1);
  root.state.context.onSelectFromLink?.('other-inbox');
  await root.state.context.onSendTimeChange?.(new Date('2026-12-01T12:00:00Z'));
  expect(services.saveDraft).toHaveBeenCalledOnce();
  expect(services.schedule).not.toHaveBeenCalled();
  expect(root.state.context.selectedFromLinkId?.()).toBe('inbox');
  pending.resolve({ message: response.draft });
  await vi.advanceTimersByTimeAsync(1);
  root.dispose();
});

it('uses the captured inbox for attachment upload when a sender switch queues behind a save', async () => {
  const pending = deferred<{ draft: SavedEmailDraft }>();
  const services = composeServices();
  services.accounts = {
    ...services.accounts,
    inboxes: () => [
      { id: 'inbox', email_address: 'me@example.com', settings: {} },
      { id: 'other', email_address: 'other@example.com', settings: {} },
    ],
    headerId: (id) => id,
  };
  vi.mocked(services.saveDraft).mockReturnValueOnce(pending.promise);
  const root = mount(services);
  root.edit('With files');
  root.state.context.onAddAttachments([
    { type: 'local', file: new File(['notes'], 'notes.txt') },
  ]);
  await vi.advanceTimersByTimeAsync(600);
  root.state.context.onSelectFromLink?.('other');
  pending.resolve(response);
  await vi.advanceTimersByTimeAsync(1);
  expect(vi.mocked(services.uploadAttachments).mock.calls[0][0].linkId).toBe(
    'inbox'
  );
  expect(vi.mocked(services.saveDraft).mock.calls[1][0].linkId).toBe('other');
  root.dispose();
});
