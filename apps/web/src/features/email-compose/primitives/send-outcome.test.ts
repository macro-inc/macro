import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  EmailComposeContext,
  EmailInbox,
  EmailSendProgress,
  EmailUndoHandle,
} from '../context/compose-capabilities';
import type { EmailRecipient } from '../core/email-recipient';
import type { ReplyType } from '../core/reply-type';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';
import type { ReplyComposerOptions } from './reply-composer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const providers = ['GMAIL', 'OUTLOOK'] as const;
const teammate: EmailRecipient = {
  kind: 'custom',
  id: 'teammate@example.com',
  data: {
    id: 'teammate@example.com',
    email: 'teammate@example.com',
    invalid: false,
  },
};

/** A composer whose queued send reports its progress as the outbox does. */
function outbox(provider: EmailInbox['provider']) {
  const context = createComposeContext();
  context.accounts.inboxes = () => [
    { id: 'inbox', email_address: 'me@example.com', provider, settings: {} },
  ];
  context.delivery.sendMessage = vi.fn(async () => ({
    sendAttemptId: 'attempt',
    persistence: 'queued' as const,
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
  }));
  const watchers = new Map<string, (progress: EmailSendProgress) => void>();
  context.delivery.watchSend = vi.fn((sendAttemptId, changed) => {
    watchers.set(sendAttemptId, changed);
    return () => watchers.delete(sendAttemptId);
  });
  return {
    context,
    report: (progress: EmailSendProgress) =>
      watchers.get('attempt')?.(progress),
  };
}

/** A thread in the inbox, completed by its send; `undo` returns it to the inbox. */
function inboxThread() {
  const undo = vi.fn(async () => {});
  const onMarkDone = vi.fn<NonNullable<ReplyComposerOptions['onMarkDone']>>(
    (options) => options?.onUndoHandle?.({ id: 'done', undo, dispose() {} })
  );
  return { undo, onMarkDone };
}

/** The notice the user sees last, whichever kind it is. */
function lastNotice(context: EmailComposeContext) {
  const { success, failure, alert } = context.notices.feedback;
  return (
    [
      ['success', vi.mocked(success).mock],
      ['failure', vi.mocked(failure).mock],
      ['alert', vi.mocked(alert).mock],
    ] as const
  )
    .flatMap(([kind, mock]) =>
      mock.invocationCallOrder.map((order) => ({ kind, order }))
    )
    .sort((left, right) => left.order - right.order)
    .at(-1)?.kind;
}

/** When the newest Undo offer ends, on this device's clock. */
function undoOfferEnds(context: EmailComposeContext) {
  const offer = vi
    .mocked(context.notices.feedback.success)
    .mock.calls.filter(([, options]) =>
      options?.actions?.some((action) => action.label === 'Undo')
    )
    .at(-1);
  const duration = offer?.[1]?.duration;
  return duration === undefined ? undefined : Date.now() + duration;
}

/** Undo offers still on screen, given notices that return their ids. */
function openUndoOffers(context: EmailComposeContext) {
  const { success, dismiss } = vi.mocked(context.notices.feedback);
  const dismissed = new Set(dismiss.mock.calls.map(([id]) => id));
  return success.mock.calls.filter(
    ([, options], index) =>
      options?.actions?.some((action) => action.label === 'Undo') &&
      !dismissed.has(success.mock.results[index]?.value)
  ).length;
}

it.each(providers)(
  '%s: keeps a delivered reply done and offers Undo until the server deadline',
  async (provider) => {
    const { context, report } = outbox(provider);
    const thread = inboxThread();
    const reply = mountReplyComposer(
      context,
      undefined,
      { onMarkDone: thread.onMarkDone },
      { inboxVisible: true }
    );
    try {
      await reply.sendEmail();
      expect(thread.onMarkDone).toHaveBeenCalledOnce();

      const undoUntil = new Date(Date.now() + 9_640).toISOString();
      report({ state: 'pending' });
      report({ state: 'accepted', undoUntil });
      expect(undoOfferEnds(context)).toBe(Date.parse(undoUntil));

      report({ state: 'pending' });
      report({ state: 'sent' });
      await vi.advanceTimersByTimeAsync(0);
      expect(thread.undo).not.toHaveBeenCalled();
      expect(thread.onMarkDone).toHaveBeenCalledOnce();
      expect(lastNotice(context)).toBe('success');
    } finally {
      reply.dispose();
    }
  }
);

it.each(
  providers.flatMap((provider) =>
    (['reply', 'forward'] as const).map((kind) => [provider, kind] as const)
  )
)(
  '%s: returns the thread to the inbox when a %s fails after it was queued',
  async (provider, kind: ReplyType) => {
    const { context, report } = outbox(provider);
    const thread = inboxThread();
    const [replyType, setReplyType] = createSignal<ReplyType | undefined>(kind);
    const reply = mountReplyComposer(
      context,
      undefined,
      { onMarkDone: thread.onMarkDone },
      {
        inboxVisible: true,
        replyRequest: { replyType, clear: () => setReplyType(undefined) },
      }
    );
    try {
      await vi.advanceTimersByTimeAsync(0);
      if (kind === 'forward') reply.form.setRecipients('to', [teammate]);
      await reply.sendEmail();
      expect(thread.onMarkDone).toHaveBeenCalledOnce();

      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 10_000).toISOString(),
      });
      report({ state: 'pending' });
      report({ state: 'failed' });
      await vi.advanceTimersByTimeAsync(0);

      expect(thread.undo).toHaveBeenCalledOnce();
      expect(lastNotice(context)).toBe('failure');
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: leaves the thread in the inbox when its failed send is restored',
  async (provider) => {
    const { context, report } = outbox(provider);
    const thread = inboxThread();
    const reply = mountReplyComposer(
      context,
      undefined,
      { onMarkDone: thread.onMarkDone },
      { inboxVisible: true }
    );
    try {
      await reply.sendEmail();
      report({ state: 'failed' });
      await vi.advanceTimersByTimeAsync(0);
      report({ state: 'cancelled' });
      await vi.advanceTimersByTimeAsync(0);

      expect(thread.undo).toHaveBeenCalledOnce();
      expect(thread.onMarkDone).toHaveBeenCalledOnce();
      expect(lastNotice(context)).toBe('failure');
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: does not archive a thread whose send failed before the advance completed',
  async (provider) => {
    const { context, report } = outbox(provider);
    let cancelled: (() => boolean) | undefined;
    const reply = mountReplyComposer(
      context,
      undefined,
      {
        onMarkDone: (options) => {
          cancelled = options?.cancelled;
        },
      },
      { inboxVisible: true }
    );
    try {
      await reply.sendEmail(true);
      expect(cancelled?.()).toBe(false);
      report({ state: 'failed' });
      await vi.advanceTimersByTimeAsync(0);
      expect(cancelled?.()).toBe(true);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: withdraws Undo when the server accepts the send after its deadline',
  async (provider) => {
    const { context, report } = outbox(provider);
    let notice = 0;
    vi.mocked(context.notices.feedback.success).mockImplementation(
      () => ++notice
    );
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      expect(openUndoOffers(context)).toBe(1);

      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() - 1_000).toISOString(),
      });
      expect(openUndoOffers(context)).toBe(0);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: returns the thread to the inbox when it is marked done after its send failed',
  async (provider) => {
    const { context, report } = outbox(provider);
    const undo = vi.fn(async () => {});
    let markedDone: ((handle: EmailUndoHandle) => void) | undefined;
    const reply = mountReplyComposer(
      context,
      undefined,
      {
        onMarkDone: (options) => {
          markedDone = options?.onUndoHandle;
        },
      },
      { inboxVisible: true }
    );
    try {
      await reply.sendEmail(true);
      report({ state: 'failed' });
      await vi.advanceTimersByTimeAsync(0);
      markedDone?.({ id: 'done', undo, dispose() {} });
      await vi.advanceTimersByTimeAsync(0);

      expect(undo).toHaveBeenCalledOnce();
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: offers Undo until the server deadline and reports a new message that fails',
  async (provider) => {
    const { context, report } = outbox(provider);
    const root = mountEmailComposer(context);
    try {
      root.edit('Quarterly numbers attached');
      await vi.advanceTimersByTimeAsync(600);
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();

      const undoUntil = new Date(Date.now() + 9_910).toISOString();
      report({ state: 'accepted', undoUntil });
      expect(undoOfferEnds(context)).toBe(Date.parse(undoUntil));

      report({ state: 'failed' });
      expect(lastNotice(context)).toBe('failure');
    } finally {
      root.dispose();
    }
  }
);
