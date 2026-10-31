import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MessageOperation } from '../../email-message/core/message-operation';
import { message } from '../../email-message/tests/messages';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-01T12:00:00Z') }));
afterEach(() => vi.useRealTimers());

function mountDraft(
  kind: 'compose' | 'reply',
  seeded: MessageOperation | null
) {
  const context = createComposeContext();
  const [operation, setOperation] = createSignal(seeded);
  context.operations = () => ({ operation, resolve: vi.fn() });
  context.setDraftLifecycle({
    type: 'editing',
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
    observedAt: Date.now(),
  });
  const draft = message('draft', { is_draft: true, operation: seeded });
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
    setOperation,
    edit: (text: string) => (compose ?? reply)?.edit(text),
    async send() {
      const sent = compose
        ? compose.state.context.onSend()
        : reply?.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      await sent;
    },
    dispose() {
      compose?.dispose();
      reply?.dispose();
    },
  };
}

it.each(['compose', 'reply'] as const)(
  'holds a %s draft the provider rejected until it accepts an edit',
  async (kind) => {
    const draft = mountDraft(kind, {
      state: 'FAILED',
      issue: 'INVALID_CONTENT',
      revision: '3',
    });
    try {
      draft.edit('Correct the rejected draft');
      await vi.advanceTimersByTimeAsync(600);
      expect(draft.context.drafts.saveDraft).toHaveBeenCalled();
      await draft.send();
      expect(draft.context.delivery.sendMessage).not.toHaveBeenCalled();
      draft.setOperation({ state: 'SYNCHRONIZED', revision: '4' });
      await draft.send();
      expect(draft.context.delivery.sendMessage).toHaveBeenCalled();
    } finally {
      draft.dispose();
    }
  }
);

it.each([
  ['compose', 'a Gmail draft without a mailbox operation', null],
  ['reply', 'a Gmail draft without a mailbox operation', null],
  ['compose', 'a synchronized Outlook draft', { state: 'SYNCHRONIZED' }],
  ['reply', 'a synchronized Outlook draft', { state: 'SYNCHRONIZED' }],
] as const)('sends from %s for %s', async (kind, _label, seeded) => {
  const draft = mountDraft(kind, seeded && { ...seeded, revision: '3' });
  try {
    draft.edit('Ready to deliver');
    await draft.send();
    expect(draft.context.delivery.sendMessage).toHaveBeenCalled();
  } finally {
    draft.dispose();
  }
});
