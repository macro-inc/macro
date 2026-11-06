import 'fake-indexeddb/auto';
import { createLocalDraftStore } from '@queries/email/local-draft-store';
import { expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { EmailDraftRestoration } from '../context/compose-capabilities';
import type { LocalDraft } from '../core/local-draft';
import { createComposeContext } from '../tests/capabilities';
import { mountReplyComposer } from '../tests/reply';

it('adopts the new local generation when the Undo callback overtakes a restoration read', async () => {
  const store = createLocalDraftStore(crypto.randomUUID());
  const owner = await store.activate('owner');
  let restoredLocal: LocalDraft;
  const context = createComposeContext();
  context.delivery.queueActive = () => true;
  context.drafts.saveLocalDraft = vi.fn(async (input) => {
    const previous = await store.read(owner, 'draft');
    return await store.save(owner, {
      key: 'draft',
      draftId: 'draft',
      threadId: 'thread',
      accountId: 'owner',
      generation:
        input.expectedGeneration ?? previous?.generation ?? 'original',
      expectedRevision: input.expectedRevision ?? previous?.revision ?? 0,
      status: 'dirty',
      content: input.draft,
      attachments: [],
    });
  });
  context.delivery.sendMessage = vi.fn(async () => ({
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    sendAttemptId: 'attempt',
    persistence: 'queued' as const,
  }));
  let changed: ((event: EmailDraftRestoration) => void) | undefined;
  context.drafts.watchRestorations = (listener) => {
    changed = listener;
    return () => {};
  };
  const restored =
    Promise.withResolvers<
      Awaited<ReturnType<NonNullable<typeof context.drafts.readDraft>>>
    >();
  context.drafts.readDraft = () => restored.promise;
  context.delivery.undoSend = vi.fn(async (input) => {
    await store.update(owner, 'draft', () => undefined);
    const generation = await store.generation(owner, 'draft', true);
    restoredLocal = await store.save(owner, {
      key: 'draft',
      draftId: 'draft',
      threadId: 'thread',
      accountId: 'owner',
      generation,
      expectedRevision: 0,
      status: 'dirty',
      content: { subject: 'Review' },
      attachments: [],
    });
    // The production adapter publishes after durable restore, then invokes onUndone.
    changed?.({
      draftId: 'draft',
      originalDraftId: 'draft',
      threadId: 'thread',
      inboxId: 'inbox',
      replyingToId: 'parent',
    });
    await input.onUndone({ draftRestored: true });
  });
  const root = mountReplyComposer(context, undefined, {
    draft: message('draft', { is_draft: true }),
  });
  try {
    root.edit('Body before sending');
    await root.sendEmail();
    const toast = vi
      .mocked(context.notices.feedback.success)
      .mock.calls.find((call) =>
        call[1]?.actions?.some((a) => a.label === 'Undo')
      );
    expect(toast).toBeDefined();
    toast![1]!.actions!.find((a) => a.label === 'Undo')!.onClick();
    await vi.waitFor(() => expect(root.editingDisabled()).toBe(true));
    restored.resolve({
      draft: message('draft', {
        is_draft: true,
        replying_to_id: 'parent',
        body_text: 'Body before sending',
        body_html_sanitized: null,
      }),
      persistence: 'queued',
      local: restoredLocal!,
    });
    await vi.waitFor(() => expect(root.editingDisabled()).toBe(false));
    root.edit('Edited after Undo');
    await root.flushLocal();
    expect(root.localSaveState()).toBe('saved');
    expect((await store.read(owner, 'draft'))?.generation).toBe(
      restoredLocal!.generation
    );
    await root.sendEmail();
    expect(context.delivery.sendMessage).toHaveBeenCalledTimes(2);
    expect(context.notices.reportError).not.toHaveBeenCalled();
  } finally {
    root.dispose();
    await store.close();
  }
});
