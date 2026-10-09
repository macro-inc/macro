import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it.each(['standalone', 'reply'] as const)(
  'continues attachment upload when Send interrupts debounce: %s',
  async (kind) => {
    const context = createComposeContext();
    context.delivery.queueActive = () => true;
    context.connectivity.looksOffline = () => true;
    context.drafts.saveLocalDraft = vi.fn(async (input) => ({
      key: input.clientHandles?.draftId ?? input.draft.db_id!,
      draftId: input.clientHandles?.draftId ?? input.draft.db_id!,
      threadId:
        input.clientHandles?.threadId ?? input.draft.thread_db_id ?? undefined,
      accountId: 'owner',
      generation: 'local-generation',
      revision: 1,
      acknowledgedRevision: 0,
      status: 'dirty' as const,
      updatedAt: Date.now(),
      content: input.draft,
      attachments: [],
    }));
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context)
        : mountReplyComposer(context);
    try {
      root.edit('Body with still-uploading image');
      context.connectivity.looksOffline = () => false;
      const file = new File(['audit'], 'audit.txt', { type: 'text/plain' });
      if ('state' in root)
        await root.state.context.onAddAttachments([{ type: 'local', file }]);
      else await root.handleAddAttachments([file]);
      if ('state' in root) root.state.context.onSend();
      else await root.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(context.attachmentStorage.uploadAttachments).toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);

it.each(['standalone', 'reply'] as const)(
  'refuses adding attachments offline and preserves existing files when sending offline: %s',
  async (kind) => {
    const context = createComposeContext();
    context.delivery.queueActive = () => true;
    let offline = true;
    context.connectivity.looksOffline = () => offline;
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context)
        : mountReplyComposer(context);
    const file = new File(['audit'], 'audit.txt');
    const add = () =>
      'state' in root
        ? root.state.context.onAddAttachments([{ type: 'local', file }])
        : root.handleAddAttachments([file]);
    try {
      await add();
      expect(context.notices.blockingNotice).toHaveBeenCalledOnce();
      offline = false;
      await add();
      root.edit('Offline attachment must be preserved');
      offline = true;
      if ('state' in root) root.state.context.onSend();
      else await root.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.notices.feedback.failure).toHaveBeenCalledWith(
        'Failed to send email',
        { subtext: 'Reconnect to send this email.' }
      );
      expect(context.attachmentStorage.removeAttachment).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);
