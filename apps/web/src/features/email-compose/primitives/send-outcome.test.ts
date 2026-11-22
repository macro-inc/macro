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
import { recordNotices } from '../tests/notices';
import { mountReplyComposer } from '../tests/reply';
import type { ReplyComposerOptions } from './reply-composer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const providers = ['GMAIL', 'OUTLOOK', 'IMAP'] as const;
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

/** Whether a notice on screen offers Undo. */
function offersUndo(notices: ReturnType<typeof recordNotices>) {
  return notices
    .open()
    .some(({ options }) =>
      options?.actions?.some((action) => action.label === 'Undo')
    );
}

it.each(providers)(
  '%s: keeps a delivered reply done and offers Undo until the server deadline',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
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

      report({ state: 'pending' });
      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 9_640).toISOString(),
      });
      await vi.advanceTimersByTimeAsync(9_639);
      expect(offersUndo(notices)).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(offersUndo(notices)).toBe(false);

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
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      expect(offersUndo(notices)).toBe(true);

      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() - 1_000).toISOString(),
      });
      expect(offersUndo(notices)).toBe(false);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: leaves no Undo on offer once a send accepted with time left is sent',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 10_000).toISOString(),
      });
      expect(offersUndo(notices)).toBe(true);

      report({ state: 'pending' });
      report({ state: 'sent' });
      expect(offersUndo(notices)).toBe(false);
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
    const notices = recordNotices(context);
    const root = mountEmailComposer(context);
    try {
      root.edit('Quarterly numbers attached');
      await vi.advanceTimersByTimeAsync(600);
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();

      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 9_910).toISOString(),
      });
      await vi.advanceTimersByTimeAsync(9_909);
      expect(offersUndo(notices)).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(offersUndo(notices)).toBe(false);

      report({ state: 'failed' });
      expect(lastNotice(context)).toBe('failure');
    } finally {
      root.dispose();
    }
  }
);

it.each(providers)(
  '%s: keeps one reply notice through sending, the undo deadline and delivery',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      report({ state: 'pending' });
      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 5_000).toISOString(),
      });
      report({ state: 'pending' });
      await vi.advanceTimersByTimeAsync(5_000);
      report({ state: 'sent' });

      expect(notices.log).toEqual([
        'open 1 success: Sending… [Undo]',
        'update 1 success: Sending…',
        'update 1 success: Email sent',
      ]);
      expect(notices.open()[0]?.options?.persistent).toBeFalsy();
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: changes one in-flight new-message notice to a timed failure',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
    const root = mountEmailComposer(context);
    try {
      root.edit('Quarterly numbers attached');
      await vi.advanceTimersByTimeAsync(600);
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(notices.open()[0]?.options?.persistent).toBe(true);

      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 5_000).toISOString(),
      });
      await vi.advanceTimersByTimeAsync(5_000);
      report({ state: 'pending' });
      report({ state: 'failed' });

      expect(notices.log).toEqual([
        'open 1 success: Sending… [Undo]',
        'update 1 success: Sending…',
        'update 1 failure: Email failed to send',
      ]);
      expect(notices.open()[0]?.options?.persistent).toBe(false);
    } finally {
      root.dispose();
    }
  }
);

it.each(providers)(
  '%s: follows a send queued offline with one notice once it goes out',
  async (provider) => {
    const { context, report } = outbox(provider);
    vi.mocked(context.connectivity.looksOffline).mockReturnValue(true);
    context.delivery.queueActive = () => true;
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      expect(notices.open()[0]?.options?.persistent).toBe(false);
      // The queued notice expires while the device is offline.
      notices.expireAll();

      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 5_000).toISOString(),
      });
      await vi.advanceTimersByTimeAsync(5_000);
      report({ state: 'sent' });

      expect(notices.log).toEqual([
        'open 1 success: Email queued to send [Undo]',
        'expire 1',
        'open 2 success: Sending… [Undo]',
        'update 2 success: Sending…',
        'update 2 success: Email sent',
      ]);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: does not bring back a sending notice the user dismissed',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      notices.expireAll();
      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 5_000).toISOString(),
      });
      await vi.advanceTimersByTimeAsync(5_000);
      report({ state: 'pending' });
      report({ state: 'sent' });

      expect(notices.log).toEqual([
        'open 1 success: Sending… [Undo]',
        'expire 1',
        'open 2 success: Email sent',
      ]);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: withdraws the sending notice when Undo is pressed',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 5_000).toISOString(),
      });
      notices.pressUndo();
      await vi.advanceTimersByTimeAsync(5_000);
      report({ state: 'pending' });
      report({ state: 'cancelled' });

      expect(notices.log).toEqual([
        'open 1 success: Sending… [Undo]',
        'dismiss 1',
      ]);
      expect(context.delivery.undoSend).toHaveBeenCalledOnce();
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: keeps a failed send on screen when its draft is restored',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      report({ state: 'failed' });
      report({ state: 'cancelled' });

      expect(notices.log).toEqual([
        'open 1 success: Sending… [Undo]',
        'update 1 failure: Email failed to send',
      ]);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: stops holding the notice for a send that stalls, and follows it again once accepted',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      report({ state: 'pending' });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(notices.open()[0]?.options?.persistent).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(notices.open()[0]?.options?.persistent).toBe(false);
      // The timed notice expires while the send keeps retrying.
      notices.expireAll();

      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 5_000).toISOString(),
      });
      expect(notices.open()[0]?.options?.persistent).toBe(true);
      report({ state: 'sent' });

      expect(notices.log).toEqual([
        'open 1 success: Sending… [Undo]',
        'update 1 success: Sending… [Undo]',
        'expire 1',
        'open 2 success: Sending… [Undo]',
        'update 2 success: Email sent',
      ]);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: a queue deadline cannot infer uncertainty before a real provider outcome',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      const accepted = {
        state: 'accepted',
        undoUntil: new Date(Date.now()).toISOString(),
      } as const;
      report(accepted);
      for (let poll = 0; poll < 5; poll++) {
        await vi.advanceTimersByTimeAsync(5_000);
        report(accepted);
      }
      await vi.advanceTimersByTimeAsync(5_000);
      expect(notices.log.at(-1)).toContain('success: Still sending…');
      report({ state: 'pending' });
      for (let poll = 0; poll < 6; poll++) {
        await vi.advanceTimersByTimeAsync(5_000);
        report({ state: 'pending' });
      }
      expect(notices.log.at(-1)).toContain('success: Still sending…');
      report({ state: 'unconfirmed' });
      expect(notices.log.at(-1)).toContain('alert: Delivery unconfirmed');
      report({ state: 'sent' });
      expect(notices.log.at(-1)).toContain('success: Email sent');
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: keeps a dismissed notice closed when its stalled send is accepted',
  async (provider) => {
    const { context, report } = outbox(provider);
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      notices.expireAll();
      await vi.advanceTimersByTimeAsync(30_000);
      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() + 5_000).toISOString(),
      });
      report({ state: 'sent' });

      expect(notices.log).toEqual([
        'open 1 success: Sending… [Undo]',
        'expire 1',
        'open 2 success: Email sent',
      ]);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  '%s: shows delivery of an offline send accepted after its undo deadline',
  async (provider) => {
    const { context, report } = outbox(provider);
    vi.mocked(context.connectivity.looksOffline).mockReturnValue(true);
    context.delivery.queueActive = () => true;
    const notices = recordNotices(context);
    const reply = mountReplyComposer(context);
    try {
      await reply.sendEmail();
      notices.expireAll();
      report({
        state: 'accepted',
        undoUntil: new Date(Date.now() - 1_000).toISOString(),
      });
      report({ state: 'sent' });

      expect(notices.log).toEqual([
        'open 1 success: Email queued to send [Undo]',
        'expire 1',
        'open 2 success: Sending…',
        'update 2 success: Email sent',
      ]);
    } finally {
      reply.dispose();
    }
  }
);

it('shows a terminal send failure once even when the send is reported again', async () => {
  const { context, report } = outbox('IMAP');
  const notices = recordNotices(context);
  const reply = mountReplyComposer(context);
  try {
    await reply.sendEmail();
    report({ state: 'failed' });
    report({ state: 'failed' });
    expect(
      notices.log.filter((line) =>
        line.includes('failure: Email failed to send')
      )
    ).toHaveLength(1);
  } finally {
    reply.dispose();
  }
});
