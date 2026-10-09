import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MessageOperation } from '../../email-message/core/message-operation';
import { message } from '../../email-message/tests/messages';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-01T12:00:00Z') }));
afterEach(() => vi.useRealTimers());

it.each(['compose', 'reply'] as const)(
  'unlocks %s after keeping the original of a reopened transferred draft',
  async (kind) => {
    const context = createComposeContext();
    const seeded: MessageOperation = {
      state: 'CONFLICT',
      revision: '1',
      issue: 'MOVE_ORIGINAL_REMAINS',
    };
    const [operation, setOperation] = createSignal<
      MessageOperation | null | undefined
    >(undefined);
    context.operations = () => ({
      operation,
      resolve: async () => {
        setOperation(null);
      },
    });
    context.setDraftLifecycle({
      type: 'editing',
      draftId: 'moved-draft',
      threadId: 'thread',
      inboxId: 'inbox',
      observedAt: Date.now(),
    });
    const draft = message('moved-draft', { is_draft: true, operation: seeded });
    const compose =
      kind === 'compose'
        ? mountEmailComposer(context, undefined, { draft })
        : undefined;
    const reply =
      kind === 'reply'
        ? mountReplyComposer(context, undefined, { draft })
        : undefined;
    const send = () => {
      if (compose) compose.state.context.onSend();
      else void reply?.sendEmail();
    };
    try {
      compose?.edit('Continue the transferred draft');
      send();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      setOperation(seeded);
      await context
        .operations(() => draft.db_id)
        .resolve(seeded, 'keep_original', false);
      send();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).toHaveBeenCalled();
    } finally {
      compose?.dispose();
      reply?.dispose();
    }
  }
);
