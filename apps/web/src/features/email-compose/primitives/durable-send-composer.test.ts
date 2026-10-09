import { $getRoot } from 'lexical';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { EmailDraftRestoration } from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import type { LocalDraft } from '../core/local-draft';
import type { ReplyType } from '../core/reply-type';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';
import type { DraftFormAttachment } from './email-form-state';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(['standalone', 'reply'] as const)(
  'requires local persistence but no server acknowledgement for an offline %s send',
  async (kind) => {
    const context = createComposeContext();
    context.delivery.queueActive = () => true;
    context.connectivity.looksOffline = () => true;
    context.drafts.saveLocalDraft = vi.fn(
      async (input): Promise<LocalDraft> => ({
        key: input.clientHandles?.draftId ?? input.draft.db_id!,
        draftId: input.clientHandles?.draftId ?? input.draft.db_id!,
        threadId:
          input.clientHandles?.threadId ??
          input.draft.thread_db_id ??
          undefined,
        accountId: 'owner',
        generation: 'local-generation',
        revision: 1,
        acknowledgedRevision: 0,
        status: 'dirty',
        updatedAt: Date.now(),
        content: input.draft,
        attachments: [],
      })
    );
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context)
        : mountReplyComposer(context);
    try {
      root.edit('Offline body');
      if ('state' in root) {
        root.state.context.onSend();
        await vi.advanceTimersByTimeAsync(0);
      } else await root.sendEmail();
      expect(context.drafts.saveLocalDraft).toHaveBeenCalled();
      expect(context.drafts.saveDraft).not.toHaveBeenCalled();
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(context.delivery.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedLocalVersion: { generation: 'local-generation', revision: 1 },
        })
      );
    } finally {
      root.dispose();
    }
  }
);

it.each(['standalone', 'reply'] as const)(
  'does not send a stale %s editor after a local revision conflict',
  async (kind) => {
    const context = createComposeContext();
    context.delivery.queueActive = () => true;
    context.drafts.saveLocalDraft = vi.fn(async () => {
      throw new Error('This draft changed while saving');
    });
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context)
        : mountReplyComposer(context);
    try {
      root.edit('Stale content');
      if ('state' in root) {
        root.state.context.onSend();
        await vi.advanceTimersByTimeAsync(0);
      } else await root.sendEmail();
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.notices.feedback.failure).toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);

function restorationContext() {
  const context = createComposeContext();
  let listener: ((event: EmailDraftRestoration) => void) | undefined;
  context.drafts.watchRestorations = (changed) => {
    listener = changed;
    return () => {
      listener = undefined;
    };
  };
  return {
    context,
    restore: (overrides: Partial<EmailDraftRestoration> = {}) =>
      listener?.({
        draftId: 'draft',
        originalDraftId: 'local-draft',
        threadId: 'thread',
        inboxId: 'inbox',
        ...overrides,
      }),
  };
}

it.each(['standalone', 'reply'] as const)(
  'uses the restored local generation for subsequent mounted %s edits',
  async (kind) => {
    const { context, restore } = restorationContext();
    const original: LocalDraft = {
      key: 'draft',
      draftId: 'draft',
      threadId: 'thread',
      accountId: 'owner',
      generation: 'original-generation',
      revision: 3,
      acknowledgedRevision: 0,
      status: 'dirty',
      updatedAt: Date.now(),
      content: { subject: 'Original' },
      attachments: [],
    };
    const restored = {
      ...original,
      generation: 'restored-generation',
      revision: 7,
    };
    context.drafts.saveLocalDraft = vi.fn(async () => original);
    context.drafts.readDraft = vi.fn(async () => ({
      draft: message('draft', {
        is_draft: true,
        replying_to_id: kind === 'reply' ? 'parent' : undefined,
        body_text: 'Restored content',
        body_html_sanitized: null,
      }),
      persistence: 'queued' as const,
      local: restored,
    }));
    const seed = { draft: message('draft', { is_draft: true }) };
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context, undefined, seed)
        : mountReplyComposer(context, undefined, seed);
    try {
      root.edit('Original editor');
      await vi.advanceTimersByTimeAsync(0);
      expect(context.drafts.saveLocalDraft).toHaveBeenCalled();
      restore({ replyingToId: kind === 'reply' ? 'parent' : undefined });
      await vi.advanceTimersByTimeAsync(0);
      root.edit('Edited after restoration');
      await vi.advanceTimersByTimeAsync(0);
      expect(context.drafts.saveLocalDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          expectedRevision: restored.revision,
          expectedGeneration: restored.generation,
        })
      );
    } finally {
      root.dispose();
    }
  }
);

it.each(['standalone', 'reply'] as const)(
  'preserves newer local files when a delayed %s restoration adopts their revision',
  async (kind) => {
    const { context, restore } = restorationContext();
    const [locked, setLocked] = createSignal(false);
    context.delivery.sendLocked = locked;
    const file: DraftFormAttachment = {
      type: 'local',
      file: new File(['new attachment'], 'new.txt', { type: 'text/plain' }),
      uploaded: false,
    };
    const local: LocalDraft = {
      key: 'draft',
      draftId: 'draft',
      threadId: 'thread',
      accountId: 'owner',
      generation: 'restored-generation',
      revision: 7,
      acknowledgedRevision: 0,
      status: 'dirty',
      updatedAt: Date.now(),
      content: { subject: 'Restored' },
      attachments: [],
    };
    context.drafts.saveLocalDraft = vi.fn(async () => local);
    context.drafts.readDraft = vi.fn(async () => ({
      draft: message('draft', {
        is_draft: true,
        replying_to_id: kind === 'reply' ? 'parent' : undefined,
        body_text: 'Restored content with a new local file',
        body_html_sanitized: null,
      }),
      persistence: 'queued' as const,
      local,
      attachments: [file],
    }));
    const seed = { draft: message('draft', { is_draft: true }) };
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context, undefined, seed)
        : mountReplyComposer(context, undefined, seed);
    try {
      setLocked(true);
      restore({ replyingToId: kind === 'reply' ? 'parent' : undefined });
      await vi.advanceTimersByTimeAsync(600);
      expect(context.drafts.readDraft).not.toHaveBeenCalled();
      setLocked(false);
      await vi.advanceTimersByTimeAsync(0);
      root.edit('Edited after restoration');
      await vi.advanceTimersByTimeAsync(0);
      expect(context.drafts.saveLocalDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          expectedRevision: local.revision,
          expectedGeneration: local.generation,
          attachments: [file],
        })
      );
    } finally {
      root.dispose();
    }
  }
);

it.each([false, true])(
  'restores the mounted standalone body and envelope when the journal unlock is delayed: %s',
  async (delayedUnlock) => {
    const { context, restore } = restorationContext();
    const [locked, setLocked] = createSignal(false);
    context.delivery.sendLocked = locked;
    context.drafts.readDraft = vi.fn(async () => ({
      draft: message('draft', {
        is_draft: true,
        subject: 'Original subject',
        body_text: 'Original body',
        body_html_sanitized: null,
      }),
      persistence: 'queued' as const,
    }));
    const root = mountEmailComposer(context, undefined, {
      draft: message('draft', { is_draft: true }),
    });
    try {
      root.edit('Send-time watermark and stale body', 'Wrong subject');
      setLocked(delayedUnlock);
      restore();
      expect(root.state.context.disabled()).toBe(true);
      if (delayedUnlock) {
        await vi.advanceTimersByTimeAsync(600);
        expect(context.drafts.readDraft).not.toHaveBeenCalled();
        expect(context.drafts.saveDraft).not.toHaveBeenCalled();
        setLocked(false);
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
        'Original body'
      );
      expect(root.state.context.subject()).toBe('Original subject');
      expect(root.state.context.disabled()).toBe(false);
      await vi.advanceTimersByTimeAsync(600);
      expect(context.drafts.saveDraft).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);

it('does not apply a restored draft after its composer unmounts', async () => {
  const { context, restore } = restorationContext();
  const pending =
    Promise.withResolvers<
      Awaited<ReturnType<NonNullable<typeof context.drafts.readDraft>>>
    >();
  context.drafts.readDraft = vi.fn(() => pending.promise);
  const root = mountEmailComposer(context, undefined, {
    draft: message('draft', { is_draft: true }),
  });
  root.edit('Keep current editor');
  restore();
  root.dispose();
  pending.resolve({
    draft: message('draft', {
      is_draft: true,
      body_text: 'Old restoration',
      body_html_sanitized: null,
    }),
    persistence: 'committed',
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
    'Keep current editor'
  );
  expect(context.drafts.saveDraft).not.toHaveBeenCalled();
});

it.each([false, true])(
  'restores a completed mounted standalone composer after cancellation with delayed unlock: %s',
  async (delayedUnlock) => {
    const { context, restore } = restorationContext();
    const [locked, setLocked] = createSignal(false);
    context.delivery.sendLocked = (id) => id === 'draft' && locked();
    context.delivery.sendMessage = vi.fn(async () => {
      setLocked(true);
      return { draftId: 'draft', threadId: 'thread', inboxId: 'inbox' };
    });
    context.drafts.readDraft = vi.fn(async () => ({
      draft: message('draft', {
        is_draft: true,
        subject: 'Recovered subject',
        body_text: 'Recovered body',
        body_html_sanitized: null,
      }),
      persistence: 'queued' as const,
    }));
    const root = mountEmailComposer(context, undefined, {
      draft: message('draft', { is_draft: true }),
    });
    try {
      root.edit('Original send');
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(root.state.draftId()).toBeUndefined();
      expect(root.state.context.disabled()).toBe(true);
      if (!delayedUnlock) setLocked(false);
      restore();
      if (delayedUnlock) {
        await vi.advanceTimersByTimeAsync(600);
        expect(context.drafts.readDraft).not.toHaveBeenCalled();
        setLocked(false);
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(root.state.draftId()).toBe('draft');
      expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
        'Recovered body'
      );
      expect(root.state.context.subject()).toBe('Recovered subject');
      expect(root.state.context.disabled()).toBe(false);
      root.edit('Edited recovered body');
      await vi.advanceTimersByTimeAsync(600);
      const saved = vi.mocked(context.drafts.saveDraft).mock.calls.at(-1)?.[0];
      expect(decodeBase64Utf8(saved?.draft.body_html ?? '')).toContain(
        'Edited recovered body'
      );
    } finally {
      root.dispose();
    }
  }
);

it('blocks queued standalone envelope, attachment, signature, schedule, delete, and send changes', async () => {
  const context = createComposeContext();
  const [locked, setLocked] = createSignal(true);
  context.delivery.sendLocked = locked;
  const root = mountEmailComposer(context, undefined, {
    draft: message('draft', { is_draft: true, subject: 'Original' }),
  });
  try {
    const composer = root.state.context;
    const recipients = composer.recipients();
    expect(composer.disabled()).toBe(true);
    expect(composer.primaryActionDisabled()).toBe(true);
    expect(composer.schedule.pickerDisabled()).toBe(true);
    expect(composer.schedule.onSelect(new Date(Date.now() + 60_000))).toBe(
      false
    );
    expect(await composer.schedule.onCancel()).toBe(false);
    composer.setSubject('Changed');
    composer.setRecipients('to', []);
    composer.onSelectInbox?.('other');
    composer.onAddAttachments([
      { type: 'local', file: new File(['audit'], 'audit.txt') },
    ]);
    root.state.setIncludeSignature(false);
    composer.onDelete?.();
    composer.onSend();
    await vi.advanceTimersByTimeAsync(600);
    expect(composer.subject()).toBe('Original');
    expect(composer.recipients()).toEqual(recipients);
    expect(composer.selectedInboxId?.()).toBe('inbox');
    expect(composer.attachments()).toEqual([]);
    expect(root.state.includeSignature()).toBe(true);
    expect(context.drafts.saveDraft).not.toHaveBeenCalled();
    expect(context.drafts.deleteDraft).not.toHaveBeenCalled();
    expect(context.delivery.sendMessage).not.toHaveBeenCalled();
    expect(context.delivery.unschedule).not.toHaveBeenCalled();
    setLocked(false);
    expect(composer.schedule.selectedTime()).toBeUndefined();
    expect(composer.schedule.actionLabel()).toBe('Send email');
  } finally {
    root.dispose();
  }
});

it.each([false, true])(
  'reopens an empty post-send reply with its restored content and attachments when the journal unlock is delayed: %s',
  async (delayedUnlock) => {
    const { context, restore } = restorationContext();
    const [locked, setLocked] = createSignal(delayedUnlock);
    context.delivery.sendLocked = locked;
    const attachment = {
      id: 'upload',
      draft_id: 'draft',
      content_type: 'text/plain',
      file_name: 'original.txt',
      s3_key: 'fixture',
      size: 12,
    };
    context.drafts.readDraft = vi.fn(async () => ({
      draft: message('draft', {
        is_draft: true,
        replying_to_id: 'parent',
        body_text: 'Original reply',
        body_html_sanitized: null,
        attachments_draft: [attachment],
      }),
      persistence: 'queued' as const,
    }));
    const showReply = vi.fn();
    const root = mountReplyComposer(context, undefined, {
      setShowReply: showReply,
    });
    try {
      restore({ replyingToId: 'parent' });
      if (delayedUnlock) {
        await vi.advanceTimersByTimeAsync(600);
        expect(context.drafts.readDraft).not.toHaveBeenCalled();
        expect(context.drafts.saveDraft).not.toHaveBeenCalled();
        expect(showReply).not.toHaveBeenCalled();
        setLocked(false);
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(root.savedDraftId()).toBe('draft');
      expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
        'Original reply'
      );
      expect(root.form.attachments.list()).toEqual([
        expect.objectContaining({
          attachmentId: 'upload',
          fileName: 'original.txt',
        }),
      ]);
      expect(showReply).toHaveBeenCalledWith(true);
      await vi.advanceTimersByTimeAsync(600);
      expect(context.drafts.saveDraft).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);

it('does not replace a newer edited reply with an earlier cancelled send', async () => {
  const { context, restore } = restorationContext();
  context.drafts.readDraft = vi.fn();
  const root = mountReplyComposer(context);
  try {
    root.edit('Newer reply text');
    restore({
      draftId: 'older-draft',
      originalDraftId: 'older-local',
      replyingToId: 'parent',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(context.drafts.readDraft).not.toHaveBeenCalled();
    expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
      'Newer reply text'
    );
  } finally {
    root.dispose();
  }
});

it.each(['forward', 'reply', 'reply-all'] as const)(
  'consumes external %s requests without changing a queued reply',
  async (type) => {
    const context = createComposeContext();
    const [locked, setLocked] = createSignal(true);
    const [request, setRequest] = createSignal<ReplyType>();
    context.delivery.sendLocked = locked;
    const clear = vi.fn(() => setRequest(undefined));
    const root = mountReplyComposer(
      context,
      undefined,
      { draft: message('draft', { is_draft: true }) },
      { replyRequest: { replyType: request, clear } }
    );
    try {
      const before = {
        type: root.form.replyType(),
        subject: root.form.subject(),
        recipients: JSON.stringify(root.form.recipients()),
      };
      setRequest(type);
      await vi.advanceTimersByTimeAsync(0);
      expect(clear).toHaveBeenCalledOnce();
      expect({
        type: root.form.replyType(),
        subject: root.form.subject(),
        recipients: JSON.stringify(root.form.recipients()),
      }).toEqual(before);
      expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
        'Ready to send'
      );
      setLocked(false);
      await vi.advanceTimersByTimeAsync(600);
      expect(root.form.replyType()).toBe(before.type);
      expect(context.drafts.saveDraft).not.toHaveBeenCalled();
    } finally {
      root.dispose();
    }
  }
);

it('waits for durable storage before applying the initial Forward on a fresh composer', async () => {
  const context = createComposeContext();
  const [locked, setLocked] = createSignal(true);
  const [request, setRequest] = createSignal<ReplyType | undefined>('forward');
  context.delivery.sendLocked = locked;
  const clear = vi.fn(() => setRequest(undefined));
  const root = mountReplyComposer(
    context,
    undefined,
    {},
    { replyRequest: { replyType: request, clear } }
  );
  try {
    expect(clear).not.toHaveBeenCalled();
    setLocked(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(root.form.replyType()).toBe('forward');
    expect(clear).toHaveBeenCalledOnce();
  } finally {
    root.dispose();
  }
});
