import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MessageOperation } from '../../email-message/core/message-operation';
import { message } from '../../email-message/tests/messages';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-01T12:00:00Z') }));
afterEach(() => vi.useRealTimers());

function mountDraft(kind: 'compose' | 'reply', seeded: MessageOperation) {
  const context = createComposeContext();
  context.accounts.inboxes = () => [
    { id: 'inbox', email_address: 'me@outlook.example', settings: {} },
    { id: 'other', email_address: 'me@gmail.example', settings: {} },
  ];
  const [operation] = createSignal(seeded);
  context.operations = () => ({ operation, resolve: vi.fn() });
  context.setDraftLifecycle({
    type: 'editing',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    observedAt: Date.now(),
  });
  const draft = message('draft', {
    is_draft: true,
    replying_to_id: kind === 'reply' ? 'parent' : null,
    operation: seeded,
  });
  const compose =
    kind === 'compose'
      ? mountEmailComposer(context, undefined, { draft })
      : undefined;
  const reply =
    kind === 'reply'
      ? mountReplyComposer(context, undefined, { draft })
      : undefined;
  return {
    context,
    async switchInbox() {
      const switched = compose
        ? compose.state.context.onSelectInbox?.('other')
        : reply?.persistDraftOnSenderSwitch('other');
      await vi.advanceTimersByTimeAsync(0);
      await switched;
    },
    dispose() {
      compose?.dispose();
      reply?.dispose();
    },
  };
}

it.each(['compose', 'reply'] as const)(
  'moves a %s draft the provider rejected to another inbox',
  async (kind) => {
    const draft = mountDraft(kind, {
      state: 'FAILED',
      issue: 'INVALID_CONTENT',
      revision: '3',
    });
    try {
      await draft.switchInbox();
      expect(draft.context.drafts.transferDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          draftId: 'draft',
          sourceInboxId: 'inbox',
          destinationInboxId: 'other',
        })
      );
    } finally {
      draft.dispose();
    }
  }
);

it.each([
  [
    'compose',
    'an unfinished move',
    { state: 'PENDING', issue: 'MOVE_PENDING' },
  ],
  ['reply', 'an unfinished move', { state: 'PENDING', issue: 'MOVE_PENDING' }],
  [
    'compose',
    'a draft conflict',
    { state: 'CONFLICT', issue: 'DRAFT_CONFLICT' },
  ],
  ['reply', 'a draft conflict', { state: 'CONFLICT', issue: 'DRAFT_CONFLICT' }],
] as const)(
  'keeps a %s draft with %s in its inbox',
  async (kind, _label, seeded) => {
    const draft = mountDraft(kind, { ...seeded, revision: '3' });
    try {
      await draft.switchInbox();
      expect(draft.context.drafts.transferDraft).not.toHaveBeenCalled();
    } finally {
      draft.dispose();
    }
  }
);
