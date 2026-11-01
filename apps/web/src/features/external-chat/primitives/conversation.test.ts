import { err, ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { chat, createFakeChat, messages } from '../tests/fake-capabilities';
import { createConversation } from './conversation';

function mountConversation(fake = createFakeChat()) {
  const notify = vi.fn();
  const restore = vi.fn();
  return createRoot((dispose) => ({
    fake,
    notify,
    restore,
    dispose,
    conversation: createConversation(fake.capabilities, () => chat.ownerId, {
      notify,
      restore,
      retryDelays: [0, 0],
    }),
  }));
}

describe('sending to an external chat', () => {
  it('shows the message at once and replaces it with the stored one', async () => {
    const state = mountConversation();
    state.conversation.reply(messages[0]);
    const delivery = state.conversation.submit({
      markdown: 'On **it**',
      attachments: [],
    });
    expect(delivery.isOk()).toBe(true);
    const pending = state.conversation.rows().at(-1);
    expect(pending).toMatchObject({
      body: 'On *it*',
      pending: true,
      replyTo: 'message-1',
      sender: { userId: chat.ownerId },
    });
    expect(state.conversation.target()).toBeUndefined();
    await delivery._unsafeUnwrap();
    const key = state.fake.capabilities.send.mock.calls[0]?.[1];
    expect(state.fake.capabilities.send).toHaveBeenCalledWith(
      { kind: 'text', text: 'On *it*', replyTo: 'message-1', mentions: [] },
      key
    );
    state.fake.setDelivery([
      { id: `send-${key}`, state: 'accepted', messageId: 'message-3' },
    ]);
    expect(state.conversation.rows().at(-1)?.pending).toBe(true);
    state.fake.setMessages([
      ...messages,
      {
        id: 'message-3',
        kind: 'message',
        sender: { name: 'Me', userId: chat.ownerId },
        mentions: [],
        forwarded: false,
        body: 'On *it*',
        sentAt: new Date().toISOString(),
        edited: false,
        deleted: false,
        replyTo: 'message-1',
        reactions: [],
        attachments: [],
      },
    ]);
    expect(state.conversation.rows().map((row) => row.id)).toEqual([
      'message-1',
      'message-2',
      'message-3',
    ]);
    expect(state.notify).not.toHaveBeenCalled();
    state.dispose();
  });

  it('removes a refused message, says why and gives the draft back', async () => {
    const state = mountConversation();
    state.fake.capabilities.send.mockResolvedValueOnce(
      err({
        kind: 'refused',
        reason: "Your WhatsApp can't send to this chat.",
      })
    );
    state.conversation.reply(messages[0]);
    const draft = { markdown: 'Hello', attachments: [] };
    await state.conversation.submit(draft)._unsafeUnwrap();
    expect(state.conversation.rows().some((row) => row.pending)).toBe(false);
    expect(state.notify).toHaveBeenCalledWith(
      "Your WhatsApp can't send to this chat."
    );
    expect(state.restore).toHaveBeenCalledWith(draft, {
      kind: 'reply',
      message: messages[0],
    });
    state.dispose();
  });

  it('retries an unknown outcome quietly with the same key', async () => {
    const state = mountConversation();
    state.fake.capabilities.send
      .mockResolvedValueOnce(err({ kind: 'unknown' }))
      .mockResolvedValueOnce(err({ kind: 'unknown' }));
    await state.conversation
      .submit({ markdown: 'Hello', attachments: [] })
      ._unsafeUnwrap();
    const keys = state.fake.capabilities.send.mock.calls.map((call) => call[1]);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(state.notify).not.toHaveBeenCalled();
    expect(state.conversation.rows().at(-1)?.pending).toBe(true);
    state.dispose();
  });

  it('after retries fail, restores the draft and resends it under the same key', async () => {
    const state = mountConversation();
    state.fake.capabilities.send.mockResolvedValue(err({ kind: 'unknown' }));
    const draft = { markdown: 'Hello', attachments: [] };
    await state.conversation.submit(draft)._unsafeUnwrap();
    expect(state.notify).toHaveBeenCalledWith(
      "Couldn't reach WhatsApp. Check your connection and try again."
    );
    expect(state.restore).toHaveBeenCalledWith(draft, undefined);
    expect(state.conversation.rows().some((row) => row.pending)).toBe(false);
    state.fake.capabilities.send.mockResolvedValue(
      ok({ id: 'send-1', state: 'pending' })
    );
    await state.conversation
      .submit({ markdown: 'Hello', attachments: [] })
      ._unsafeUnwrap();
    const keys = state.fake.capabilities.send.mock.calls.map((call) => call[1]);
    expect(new Set(keys).size).toBe(1);
    state.dispose();
  });

  it('reports a send WhatsApp rejected after recording it', async () => {
    const state = mountConversation();
    const draft = { markdown: 'Hello', attachments: [] };
    await state.conversation.submit(draft)._unsafeUnwrap();
    const key = state.fake.capabilities.send.mock.calls[0]?.[1];
    state.fake.setDelivery([
      { id: `send-${key}`, state: 'failed', errorCode: 'send_expired' },
    ]);
    expect(state.notify).toHaveBeenCalledWith(
      "WhatsApp wasn't reachable for 10 minutes, so this wasn't sent."
    );
    expect(state.restore).toHaveBeenCalledWith(draft, undefined);
    expect(state.conversation.rows().some((row) => row.pending)).toBe(false);
    state.dispose();
  });

  it('tells the sender the recipient is not on WhatsApp', async () => {
    const state = mountConversation();
    await state.conversation
      .submit({ markdown: 'Hello', attachments: [] })
      ._unsafeUnwrap();
    const key = state.fake.capabilities.send.mock.calls[0]?.[1];
    state.fake.setDelivery([
      {
        id: `send-${key}`,
        state: 'failed',
        errorCode: 'recipient_not_on_provider',
      },
    ]);
    expect(state.notify).toHaveBeenCalledWith(
      "This person isn't on WhatsApp, so this wasn't sent."
    );
    state.dispose();
  });

  it('keeps a draft WhatsApp could not take, without sending', () => {
    const state = mountConversation(
      createFakeChat({
        chat: { ...chat, limits: { ...chat.limits, textBytes: 4 } },
      })
    );
    const delivery = state.conversation.submit({
      markdown: 'Too long',
      attachments: [],
    });
    expect(delivery._unsafeUnwrapErr()).toBe(
      'This message is too long for WhatsApp.'
    );
    expect(state.fake.capabilities.send).not.toHaveBeenCalled();
    state.dispose();
  });

  it('sends a caption with a file, and after an audio file on its own', async () => {
    const state = mountConversation();
    state.fake.capabilities.upload.mockResolvedValueOnce(
      ok({ uploadId: 'voice-1', audio: true })
    );
    await state.conversation.upload(
      new File(['a'], 'note.ogg', { type: 'audio/ogg' })
    );
    await state.conversation
      .submit({
        markdown: 'Listen',
        attachments: [{ id: 'voice-1', name: 'note.ogg' }],
      })
      ._unsafeUnwrap();
    await state.conversation
      .submit({
        markdown: 'Plan',
        attachments: [{ id: 'upload-2', name: 'plan.pdf' }],
      })
      ._unsafeUnwrap();
    expect(
      state.fake.capabilities.send.mock.calls.map((call) => call[0])
    ).toEqual([
      {
        kind: 'media',
        uploadId: 'voice-1',
        caption: undefined,
        replyTo: undefined,
      },
      { kind: 'text', text: 'Listen', mentions: [] },
      {
        kind: 'media',
        uploadId: 'upload-2',
        caption: 'Plan',
        replyTo: undefined,
      },
    ]);
    state.dispose();
  });

  it('refuses files outside the chat limits before uploading', async () => {
    const state = mountConversation();
    const result = await state.conversation.upload(
      new File(['a'], 'clip.gif', { type: 'image/gif' })
    );
    expect(result._unsafeUnwrapErr()).toBe(
      "WhatsApp doesn't accept clip.gif's file type."
    );
    expect(state.fake.capabilities.upload).not.toHaveBeenCalled();
    state.dispose();
  });

  it('toggles the viewer reaction and reports a refusal', async () => {
    const state = mountConversation();
    await state.conversation.react(messages[0], '👍');
    expect(state.fake.capabilities.send).toHaveBeenLastCalledWith(
      { kind: 'reaction', messageId: 'message-1', emoji: '' },
      expect.any(String)
    );
    state.fake.capabilities.send.mockResolvedValueOnce(
      err({ kind: 'refused', reason: "Your WhatsApp can't send to this chat." })
    );
    await state.conversation.react(messages[0], '🎉');
    expect(state.notify).toHaveBeenCalledWith(
      "Your WhatsApp can't send to this chat."
    );
    state.dispose();
  });
});

describe('reading an external chat', () => {
  it('marks the newest message read once however often scrolling asks, and again after a failure', async () => {
    const state = mountConversation();
    let fail!: (error: Error) => void;
    state.fake.capabilities.markRead.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const first = state.conversation.markRead();
    const second = state.conversation.markRead();
    expect(state.fake.capabilities.markRead).toHaveBeenCalledOnce();
    await second;

    fail(new Error('offline'));
    await expect(first).rejects.toThrow('offline');
    await state.conversation.markRead();
    expect(state.fake.capabilities.markRead).toHaveBeenCalledTimes(2);
    await state.conversation.markRead();
    expect(state.fake.capabilities.markRead).toHaveBeenCalledTimes(2);
    state.dispose();
  });
});
