import type { LexicalEditor } from 'lexical';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type {
  EmailComposeContext,
  EmailDraftRestoration,
  EmailInbox,
} from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import type { EmailRecipient } from '../core/email-recipient';
import type { ReplyType } from '../core/reply-type';
import { createComposeContext } from '../tests/capabilities';
import { createEmailEditor } from '../tests/editor';
import { mountReplyComposer } from '../tests/reply';
import {
  prepareEmailBody,
  registerToggleAppendedThread,
  TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
} from './prepare-email-body';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const parent = message('parent', {
  from: { name: 'Ada Lovelace', email: 'ada@example.com' },
  to: [{ email: 'me@example.com' }],
  subject: 'Numbers',
  body_html_sanitized: '<p>Original message text</p>',
});
const teammate: EmailRecipient = {
  kind: 'custom',
  id: 'teammate@example.com',
  data: {
    id: 'teammate@example.com',
    email: 'teammate@example.com',
    invalid: false,
  },
};
const providers = ['GMAIL', 'OUTLOOK'] as const;

function inboxContext(provider: EmailInbox['provider']) {
  const context = createComposeContext();
  context.accounts.inboxes = () => [
    { id: 'inbox', email_address: 'me@example.com', provider, settings: {} },
  ];
  // Undo restores by the sent draft's identity.
  context.delivery.sendMessage = vi.fn(async () => ({
    draftId: 'draft',
    threadId: 'thread',
    inboxId: 'inbox',
  }));
  return context;
}

/** The message card's Reply and Forward buttons. */
function cardActions(initial?: ReplyType) {
  const [replyType, setReplyType] = createSignal<ReplyType | undefined>(
    initial
  );
  return {
    replyType,
    clear: () => setReplyType(undefined),
    click: async (next: ReplyType) => {
      setReplyType(next);
      // The composer appends quoted content once the editor registers it.
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

/** A draft saved from a real editor, as the thread's draft slot returns it. */
function savedDraft(
  replyType: ReplyType,
  text: string,
  quoted = parent,
  overrides: Parameters<typeof message>[1] = {}
) {
  const editor = createEmailEditor(text);
  registerToggleAppendedThread(editor);
  editor.dispatchCommand(TOGGLE_APPEND_EMAIL_THREAD_COMMAND, {
    replyingTo: quoted,
    replyType,
    visible: true,
  });
  return message('draft', {
    is_draft: true,
    replying_to_id: 'parent',
    from: { email: 'me@example.com' },
    body_html_sanitized: prepareEmailBody(editor)!.bodyHtml,
    ...overrides,
  });
}

function savedForward() {
  return savedDraft('forward', 'FYI, see below', parent, {
    to: [{ email: 'teammate@example.com' }],
    subject: 'Fwd: Numbers',
  });
}

function typeAboveQuote(
  reply: ReturnType<typeof mountReplyComposer>,
  text: string
) {
  const editor: LexicalEditor = reply.editor;
  editor.update(
    () => {
      const paragraph = $createParagraphNode().append($createTextNode(text));
      const first = $getRoot().getFirstChild();
      if (first) first.insertBefore(paragraph);
      else $getRoot().append(paragraph);
    },
    { discrete: true }
  );
  reply.onContentChange(text);
}

function delivered(context: EmailComposeContext, call = 0) {
  const sent = vi.mocked(context.delivery.sendMessage).mock.calls[call][0];
  return {
    body: decodeBase64Utf8(sent.message.body_html ?? ''),
    to: sent.message.to?.map((contact) => contact.email),
    subject: sent.message.subject,
  };
}

it.each(providers)(
  'sends a %s reply without the forward the same composer failed to send',
  async (provider) => {
    const context = inboxContext(provider);
    vi.mocked(context.delivery.sendMessage).mockRejectedValueOnce(
      new Error('provider rejected the forward')
    );
    const actions = cardActions();
    const reply = mountReplyComposer(
      context,
      () => parent,
      {},
      {
        replyRequest: actions,
      }
    );
    try {
      await actions.click('forward');
      reply.form.setRecipients('to', [teammate]);
      await reply.sendEmail();
      expect(context.notices.feedback.failure).toHaveBeenCalledWith(
        'Failed to send email'
      );

      await actions.click('reply');
      typeAboveQuote(reply, 'Reply test body');
      await reply.sendEmail();

      expect(context.delivery.sendMessage).toHaveBeenCalledTimes(2);
      const sent = delivered(context, 1);
      expect(sent.to).toEqual(['ada@example.com']);
      expect(sent.body).toContain('Reply test body');
      expect(sent.body).toContain('wrote:');
      expect(sent.body).not.toContain('Forwarded message');
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  'sends a %s forward with the forwarded message to its recipient',
  async (provider) => {
    const context = inboxContext(provider);
    const actions = cardActions();
    const reply = mountReplyComposer(
      context,
      () => parent,
      {},
      {
        replyRequest: actions,
      }
    );
    try {
      await actions.click('forward');
      reply.form.setRecipients('to', [teammate]);
      await reply.sendEmail();

      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      const sent = delivered(context);
      expect(sent.to).toEqual(['teammate@example.com']);
      expect(sent.subject).toBe('Fwd: Numbers');
      expect(sent.body).toContain('Forwarded message');
      expect(sent.body).toContain('Original message text');
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  'forwards a %s reply that was showing its quote with the forwarded message',
  async (provider) => {
    const context = inboxContext(provider);
    const actions = cardActions();
    const reply = mountReplyComposer(
      context,
      () => parent,
      {},
      {
        replyRequest: actions,
      }
    );
    try {
      reply.toggleQuotedText();
      await actions.click('forward');
      reply.form.setRecipients('to', [teammate]);
      await reply.sendEmail();

      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      const sent = delivered(context);
      expect(sent.body).toContain('Forwarded message');
      expect(sent.body).not.toContain('wrote:');
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  'turns a saved %s forward into a reply when Reply reopens its slot',
  async (provider) => {
    const context = inboxContext(provider);
    const draft = savedForward();
    const reply = mountReplyComposer(
      context,
      () => parent,
      {
        draft,
        preloadedHtml: decodeBase64Utf8(draft.body_html_sanitized ?? ''),
      },
      { replyRequest: cardActions('reply') }
    );
    try {
      await vi.advanceTimersByTimeAsync(0);
      await reply.sendEmail();

      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      const sent = delivered(context);
      expect(sent.to).toEqual(['ada@example.com']);
      expect(sent.subject).toBe('Re: Numbers');
      expect(sent.body).toContain('FYI, see below');
      expect(sent.body).toContain('wrote:');
      expect(sent.body).not.toContain('Forwarded message');
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  'keeps a saved %s forward and its recipients when Forward reopens its slot',
  async (provider) => {
    const context = inboxContext(provider);
    const draft = savedForward();
    const reply = mountReplyComposer(
      context,
      () => parent,
      {
        draft,
        preloadedHtml: decodeBase64Utf8(draft.body_html_sanitized ?? ''),
      },
      { replyRequest: cardActions('forward') }
    );
    try {
      await vi.advanceTimersByTimeAsync(0);
      await reply.sendEmail();

      expect(context.notices.feedback.failure).not.toHaveBeenCalled();
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      const sent = delivered(context);
      expect(sent.to).toEqual(['teammate@example.com']);
      expect(sent.subject).toBe('Fwd: Numbers');
      expect(sent.body).toContain('FYI, see below');
      expect(sent.body.match(/Forwarded message/g)).toHaveLength(1);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  'keeps a %s forward restored from its local copy a forward',
  async (provider) => {
    const context = inboxContext(provider);
    let restore: ((change: EmailDraftRestoration) => void) | undefined;
    context.drafts.watchRestorations = (listener) => {
      restore = listener;
      return () => {};
    };
    context.drafts.readDraft = vi.fn(async () => ({
      draft: savedForward(),
      persistence: 'committed' as const,
    }));
    const actions = cardActions();
    const reply = mountReplyComposer(
      context,
      () => parent,
      {},
      {
        replyRequest: actions,
      }
    );
    try {
      restore?.({
        draftId: 'draft',
        originalDraftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        replyingToId: 'parent',
      });
      await vi.waitFor(() => expect(reply.savedDraftId()).toBe('draft'));

      await actions.click('forward');
      await reply.sendEmail();

      expect(context.notices.feedback.failure).not.toHaveBeenCalled();
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      const sent = delivered(context);
      expect(sent.to).toEqual(['teammate@example.com']);
      expect(sent.body.match(/Forwarded message/g)).toHaveLength(1);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  'reopens an undone %s forward as a forward',
  async (provider) => {
    const context = inboxContext(provider);
    context.delivery.undoSend = vi.fn(async (input) => {
      await input.onUndone();
    });
    const actions = cardActions();
    const reply = mountReplyComposer(
      context,
      () => parent,
      {},
      {
        replyRequest: actions,
      }
    );
    try {
      await actions.click('forward');
      reply.form.setRecipients('to', [teammate]);
      await reply.sendEmail();
      const undo = vi
        .mocked(context.notices.feedback.success)
        .mock.calls.flatMap(([, options]) => options?.actions ?? [])
        .find((action) => action.label === 'Undo');
      undo?.onClick();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      await actions.click('forward');
      await reply.sendEmail();

      expect(context.notices.feedback.failure).not.toHaveBeenCalled();
      expect(context.delivery.sendMessage).toHaveBeenCalledTimes(2);
      const sent = delivered(context, 1);
      expect(sent.to).toEqual(['teammate@example.com']);
      expect(sent.body.match(/Forwarded message/g)).toHaveLength(1);
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  'keeps a reopened %s reply that quotes a forwarded message a reply',
  async (provider) => {
    const context = inboxContext(provider);
    const forwardedToMe = message('parent', {
      ...parent,
      body_html_sanitized:
        '<p>Passing this along</p><div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ----------<br>From: Bob</div><p>Bob wrote this</p></div>',
    });
    const draft = savedDraft('reply', 'Thanks, noted', forwardedToMe, {
      to: [{ email: 'ada@example.com' }],
      cc: [{ email: 'teammate@example.com' }],
      subject: 'Re: Numbers',
    });
    const reply = mountReplyComposer(
      context,
      () => forwardedToMe,
      {
        draft,
        preloadedHtml: decodeBase64Utf8(draft.body_html_sanitized ?? ''),
      },
      { replyRequest: cardActions('reply') }
    );
    try {
      await vi.advanceTimersByTimeAsync(0);
      await reply.sendEmail();

      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      const sent = delivered(context);
      const { message: sentMessage } = vi.mocked(context.delivery.sendMessage)
        .mock.calls[0][0];
      expect(sent.to).toEqual(['ada@example.com']);
      expect(sentMessage.cc?.map((contact) => contact.email)).toEqual([
        'teammate@example.com',
      ]);
      expect(sent.body).toContain('wrote:');
      expect(sent.body).toContain('Bob wrote this');
    } finally {
      reply.dispose();
    }
  }
);

it.each(providers)(
  'drops a %s forward newer than the thread draft when Reply is clicked',
  async (provider) => {
    const context = inboxContext(provider);
    // The thread still holds the saved reply; the editor loads the newer
    // local copy, which became a forward.
    const draft = savedDraft('reply', 'FYI, see below', parent, {
      to: [{ email: 'ada@example.com' }],
      subject: 'Re: Numbers',
    });
    const localCopy = decodeBase64Utf8(
      savedForward().body_html_sanitized ?? ''
    );
    const actions = cardActions();
    const reply = mountReplyComposer(
      context,
      () => parent,
      { draft, preloadedHtml: localCopy },
      { replyRequest: actions }
    );
    try {
      await vi.advanceTimersByTimeAsync(0);
      await actions.click('reply');
      await reply.sendEmail();

      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      const sent = delivered(context);
      expect(sent.to).toEqual(['ada@example.com']);
      expect(sent.body).toContain('FYI, see below');
      expect(sent.body).not.toContain('Forwarded message');
    } finally {
      reply.dispose();
    }
  }
);
