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
it.each(['standalone', 'reply'] as const)(
  'retains restoration preceding delayed send completion: %s',
  async (kind) => {
    const context = createComposeContext();
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
      else void root.sendEmail();
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
      ).toBe(false);
    } finally {
      root.dispose();
    }
  }
);
