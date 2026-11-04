import { fireAndForget } from '@core/util/fireAndForget';
import { $getRoot } from 'lexical';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { EmailDraftRestoration } from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each([false, true])(
  'cancels delayed mark-done when the queued reply is restored: %s',
  async (restore) => {
    const context = createComposeContext();
    const archived = vi.fn();
    let completeMarkDone = () => {};
    let listener: ((event: EmailDraftRestoration) => void) | undefined;
    context.drafts.watchRestorations = (changed) => {
      listener = changed;
      return () => {};
    };
    context.drafts.readDraft = vi.fn(async () => ({
      draft: message('draft', {
        is_draft: true,
        replying_to_id: 'parent',
        body_text: 'Restored body',
        body_html_sanitized: null,
      }),
      persistence: 'queued' as const,
    }));
    const root = mountReplyComposer(context, undefined, {
      draft: message('draft', { is_draft: true }),
      onMarkDone: (options) => {
        completeMarkDone = () => {
          if (!options?.cancelled?.()) archived();
        };
        return true;
      },
    });
    try {
      await root.sendEmail(true);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      if (restore) {
        listener?.({
          draftId: 'draft',
          originalDraftId: 'draft',
          threadId: 'thread',
          inboxId: 'inbox',
          replyingToId: 'parent',
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
          'Restored body'
        );
      }
      completeMarkDone();
      expect(archived).toHaveBeenCalledTimes(restore ? 0 : 1);
    } finally {
      root.dispose();
    }
  }
);

it.each([
  ['standalone', false],
  ['reply', false],
  ['standalone', true],
  ['reply', true],
] as const)(
  'retains restoration and the current send phase: %s, preparing another send: %s',
  async (kind, sendAgain) => {
    const context = createComposeContext();
    context.delivery.queueActive = () => true;
    context.drafts.saveLocalDraft = vi.fn(async (input) => ({
      key: input.draft.db_id ?? input.clientHandles?.draftId ?? 'draft',
      draftId: input.draft.db_id ?? input.clientHandles?.draftId ?? 'draft',
      threadId: 'thread',
      accountId: 'owner',
      generation: 'original',
      revision: 1,
      acknowledgedRevision: 0,
      status: 'dirty' as const,
      updatedAt: Date.now(),
      content: input.draft,
      attachments: [],
    }));
    let listener: ((event: EmailDraftRestoration) => void) | undefined;
    context.drafts.watchRestorations = (changed) => {
      listener = changed;
      return () => {};
    };
    const [locked, setLocked] = createSignal(false);
    context.delivery.sendLocked = locked;
    let finish: (() => void) | undefined;
    context.delivery.sendMessage = vi.fn(async () => {
      setLocked(true);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        sendAttemptId: 'attempt',
        persistence: 'queued' as const,
      };
    });
    context.drafts.readDraft = vi.fn(async () => ({
      draft: message('draft', {
        is_draft: true,
        replying_to_id: kind === 'reply' ? 'parent' : undefined,
        subject: 'Restored subject',
        body_text: 'Restored body',
        body_html_sanitized: null,
      }),
      persistence: 'queued' as const,
    }));
    const root =
      kind === 'standalone'
        ? mountEmailComposer(context, undefined, {
            draft: message('draft', { is_draft: true }),
          })
        : mountReplyComposer(context, undefined, {
            draft: message('draft', { is_draft: true }),
          });
    try {
      root.edit('Original body');
      if ('state' in root) root.state.context.onSend();
      else fireAndForget(root.sendEmail(), 'email-restoration-test');
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      setLocked(false);
      listener?.({
        draftId: 'draft',
        originalDraftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        replyingToId: kind === 'reply' ? 'parent' : undefined,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
        'Restored body'
      );
      expect(
        'state' in root ? root.state.context.disabled() : root.editingDisabled()
      ).toBe(false);
      if (sendAgain) {
        context.drafts.saveLocalDraft = vi.fn(
          () => new Promise<never>(() => {})
        );
        if ('state' in root) root.state.context.onSend();
        else fireAndForget(root.sendEmail(), 'email-restoration-test');
        await vi.advanceTimersByTimeAsync(0);
        expect(context.drafts.saveLocalDraft).toHaveBeenCalledOnce();
        expect(
          'state' in root
            ? root.state.context.disabled()
            : root.editingDisabled()
        ).toBe(true);
      }
      finish?.();
      await vi.advanceTimersByTimeAsync(0);
      expect('state' in root ? root.state.draftId() : root.savedDraftId()).toBe(
        'draft'
      );
      expect(root.editor.read(() => $getRoot().getTextContent())).toBe(
        'Restored body'
      );
      expect(
        'state' in root ? root.state.context.disabled() : root.editingDisabled()
      ).toBe(sendAgain);
    } finally {
      root.dispose();
    }
  }
);
