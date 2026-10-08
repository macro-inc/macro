import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type {
  PersistedEmailIdentity,
  SendEmailDraft,
} from '../../email-compose/context/compose-capabilities';
import { createComposeContext } from '../../email-compose/tests/capabilities';
import { createThreadContext, message, thread } from '../tests/fixtures';
import { createOptimisticThreadSend } from './optimistic-send';

const input: SendEmailDraft = {
  inboxId: 'inbox',
  message: {
    db_id: 'draft',
    thread_db_id: 'thread',
    subject: 'Final subject',
    body_text: 'café',
    body_html: 'PHA+Y2Fmw6k8L3A+',
    to: [{ email: 'recipient@example.com' }],
  },
};
const identity: PersistedEmailIdentity = {
  draftId: 'draft',
  threadId: 'thread',
  inboxId: 'inbox',
};

function setup() {
  return createRoot((dispose) => {
    const draft = message('draft', {
      is_draft: true,
      body_text: 'Older body',
      body_replyless: 'Older reply',
      labels: [{ provider_label_id: 'DRAFT' }],
      attachments_draft: [
        {
          id: 'file',
          s3_key: 'file',
          file_name: 'Notes.txt',
          content_type: 'text/plain',
          size: 20,
        },
      ],
    });
    const [snapshot, setSnapshot] = createSignal(
      thread([message('received'), draft])
    );
    const compose = createComposeContext();
    const request = Promise.withResolvers<PersistedEmailIdentity>();
    vi.mocked(compose.delivery.sendMessage).mockReturnValue(request.promise);
    const optimistic = createOptimisticThreadSend(
      createThreadContext({ thread: snapshot }).source,
      compose
    );
    return { ...optimistic, compose, request, snapshot, setSnapshot, dispose };
  });
}

it.each(['reply', 'standalone'] as const)(
  'shows a %s before send settles and retains it until the thread refreshes',
  async (kind) => {
    const state = setup();
    try {
      const sendInput =
        kind === 'standalone'
          ? { ...input, message: { ...input.message, thread_db_id: undefined } }
          : input;
      const send = state.delivery.sendMessage(sendInput);
      expect(state.compose.delivery.sendMessage).toHaveBeenCalledWith(
        sendInput
      );
      expect(
        state.source.thread()?.messages.map((message) => message.db_id)
      ).toEqual(['received', 'draft']);
      expect(state.source.thread()?.messages[1]).toMatchObject({
        is_draft: false,
        subject: 'Final subject',
        body_text: 'café',
        body_html_sanitized: '<p>café</p>',
        body_replyless: null,
        from: { email: 'me@example.com' },
        to: [{ email: 'recipient@example.com' }],
        labels: [],
        attachments_draft: [{ id: 'file' }],
        sent_at: expect.any(String),
      });
      // The optimistic projection never changes the underlying draft snapshot.
      expect(state.snapshot().messages[1].is_draft).toBe(true);
      state.request.resolve(identity);
      await expect(send).resolves.toEqual(identity);
      expect(state.source.thread()?.messages[1].is_draft).toBe(false);
      state.setSnapshot(
        thread([
          message('received'),
          message('draft', { body_text: 'Server body' }),
        ])
      );
      expect(
        state.source.thread()?.messages.map((message) => message.body_text)
      ).toEqual([undefined, 'Server body']);
      state.setSnapshot(thread([message('received')]));
      expect(state.source.thread()?.messages).toHaveLength(1);
    } finally {
      state.dispose();
    }
  }
);

it('removes a failed optimistic send while preserving a newer draft edit', async () => {
  const state = setup();
  try {
    const send = state.delivery.sendMessage(input);
    const rejected = expect(send).rejects.toThrow('Delivery failed');
    state.setSnapshot(
      thread([
        message('received'),
        message('draft', { is_draft: true, body_text: 'Newer edit' }),
      ])
    );
    state.request.reject(new Error('Delivery failed'));
    await rejected;
    expect(state.source.thread()?.messages[1]).toMatchObject({
      is_draft: true,
      body_text: 'Newer edit',
    });
  } finally {
    state.dispose();
  }
});

it('adopts the server identity without duplicating the draft or the sent message', async () => {
  const state = setup();
  try {
    const send = state.delivery.sendMessage(input);
    state.request.resolve({ ...identity, draftId: 'server-message' });
    await send;
    expect(
      state.source.thread()?.messages.map((message) => message.db_id)
    ).toEqual(['received', 'server-message']);
    state.setSnapshot(
      thread([
        message('received'),
        message('server-message', { body_text: 'Confirmed' }),
      ])
    );
    expect(state.source.thread()?.messages).toHaveLength(2);
    expect(state.source.thread()?.messages[1].body_text).toBe('Confirmed');
  } finally {
    state.dispose();
  }
});

it('rolls back only the failed send when multiple sends are in flight', async () => {
  const state = setup();
  try {
    const second = Promise.withResolvers<PersistedEmailIdentity>();
    vi.mocked(state.compose.delivery.sendMessage)
      .mockReturnValueOnce(state.request.promise)
      .mockReturnValueOnce(second.promise);
    const firstSend = state.delivery.sendMessage(input);
    const failed = expect(firstSend).rejects.toThrow();
    const secondSend = state.delivery.sendMessage({
      ...input,
      message: { ...input.message, db_id: 'second', body_text: 'Second reply' },
    });
    state.request.reject(new Error('Failed'));
    await failed;
    expect(state.source.thread()?.messages.at(-1)).toMatchObject({
      db_id: 'second',
      is_draft: false,
      body_text: 'Second reply',
    });
    expect(state.source.thread()?.messages[1].is_draft).toBe(true);
    second.resolve({ ...identity, draftId: 'second' });
    await secondSend;
  } finally {
    state.dispose();
  }
});

it('removes the optimistic message only after Undo Send succeeds', async () => {
  const state = setup();
  try {
    const send = state.delivery.sendMessage(input);
    state.request.resolve(identity);
    await send;
    const onUndone = vi.fn();
    const undo = { draftId: 'draft', inboxId: 'inbox', onUndone };
    vi.mocked(state.compose.delivery.undoSend).mockRejectedValueOnce(
      new Error('Undo failed')
    );
    await expect(state.delivery.undoSend(undo)).rejects.toThrow('Undo failed');
    expect(state.source.thread()?.messages[1].is_draft).toBe(false);
    vi.mocked(state.compose.delivery.undoSend).mockImplementation(
      async ({ onUndone }) => {
        await onUndone();
      }
    );
    await state.delivery.undoSend(undo);
    expect(state.source.thread()?.messages[1].is_draft).toBe(true);
    expect(onUndone).toHaveBeenCalledOnce();
  } finally {
    state.dispose();
  }
});

it('keeps optimistic sends scoped to their thread when the source navigates', async () => {
  const state = setup();
  try {
    const send = state.delivery.sendMessage(input);
    state.setSnapshot(thread([message('other')], { db_id: 'other-thread' }));
    expect(
      state.source.thread()?.messages.map((message) => message.db_id)
    ).toEqual(['other']);
    state.request.resolve(identity);
    await send;
    expect(state.source.thread()?.messages).toHaveLength(1);
  } finally {
    state.dispose();
  }
});
