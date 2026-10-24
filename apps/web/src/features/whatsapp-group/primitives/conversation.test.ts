import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createFakeGroup, group, messages } from '../tests/fake-capabilities';
import { createConversation } from './conversation';

describe('WhatsApp conversation draft', () => {
  it('keeps a draft and reply through polling and clears only after sending', async () => {
    const state = createRoot((dispose) => {
      const fake = createFakeGroup();
      return {
        fake,
        conversation: createConversation(
          fake.capabilities,
          () => group.ownerId
        ),
        dispose,
      };
    });
    state.conversation.setDraft('Reply from my own WhatsApp');
    state.conversation.reply(messages[0]);
    state.fake.setMessages([...messages]);
    expect(state.conversation.draft()).toBe('Reply from my own WhatsApp');
    await state.conversation.submit();
    expect(state.fake.capabilities.send).toHaveBeenCalledWith(
      {
        kind: 'text',
        text: 'Reply from my own WhatsApp',
        replyTo: 'message-1',
      },
      expect.any(String)
    );
    expect(state.conversation.draft()).toBe('');
    expect(state.conversation.quote()).toBeUndefined();
    state.dispose();
  });
  it('keeps the draft after an ambiguous failure and never automatically retries', async () => {
    const state = createRoot((dispose) => {
      const fake = createFakeGroup();
      fake.capabilities.send.mockRejectedValueOnce(
        new Error('Connection lost')
      );
      return {
        fake,
        conversation: createConversation(
          fake.capabilities,
          () => group.ownerId
        ),
        dispose,
      };
    });
    state.conversation.setDraft('Please check before resending');
    await state.conversation.submit();
    state.fake.setMessages([...messages]);
    expect(state.fake.capabilities.send).toHaveBeenCalledOnce();
    expect(state.conversation.draft()).toBe('Please check before resending');
    expect(state.conversation.error()).toContain('Check WhatsApp');
    state.dispose();
  });
  it('blocks sends without the viewers own connected membership and oversized files', async () => {
    const state = createRoot((dispose) => {
      const fake = createFakeGroup({ group: { ...group, canSend: false } });
      return {
        fake,
        conversation: createConversation(
          fake.capabilities,
          () => group.ownerId
        ),
        dispose,
      };
    });
    state.conversation.setDraft('Cannot send');
    await state.conversation.submit();
    expect(state.fake.capabilities.send).not.toHaveBeenCalled();
    state.fake.setGroup(group);
    state.conversation.setFile(
      new File(['test'], 'program.exe', { type: 'application/octet-stream' })
    );
    await state.conversation.submit();
    expect(state.fake.capabilities.upload).not.toHaveBeenCalled();
    expect(state.conversation.error()).toContain('not supported');
    state.dispose();
  });
});

it('rechecks the mutation window after a delete confirmation waits', async () => {
  const state = createRoot((dispose) => {
    const fake = createFakeGroup();
    const conversation = createConversation(
      fake.capabilities,
      () => group.ownerId
    );
    fake.setGroup({ ...group, limits: { ...group.limits, editSeconds: 0 } });
    return { fake, conversation, dispose };
  });
  await state.conversation.mutate({ kind: 'delete', messageId: 'message-2' });
  expect(state.fake.capabilities.send).not.toHaveBeenCalled();
  expect(state.conversation.error()).toContain('no longer be changed');
  state.dispose();
});

it('never silently discards a file selected during an edit', async () => {
  const state = createRoot((dispose) => {
    const fake = createFakeGroup();
    return {
      fake,
      conversation: createConversation(fake.capabilities, () => group.ownerId),
      dispose,
    };
  });
  state.conversation.edit(messages[1]);
  state.conversation.setFile(
    new File(['test'], 'design.pdf', { type: 'application/pdf' })
  );
  await state.conversation.submit();
  expect(state.fake.capabilities.send).not.toHaveBeenCalled();
  expect(state.conversation.file()?.name).toBe('design.pdf');
  expect(state.conversation.error()).toContain('Attachments cannot be changed');
  state.dispose();
});

it('does not send a staged attachment after the signed-in identity changes', async () => {
  let finishUpload!: (value: { uploadId: string; audio: boolean }) => void;
  const state = createRoot((dispose) => {
    const fake = createFakeGroup();
    const [userId, setUserId] = createSignal(group.ownerId);
    fake.capabilities.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        })
    );
    return {
      fake,
      setUserId,
      conversation: createConversation(fake.capabilities, userId),
      dispose,
    };
  });
  state.conversation.setDraft('Keep this caption');
  state.conversation.setFile(
    new File(['test'], 'design.pdf', { type: 'application/pdf' })
  );
  const sending = state.conversation.submit();
  state.setUserId('macro|another@example.test');
  finishUpload({ uploadId: 'staged-upload', audio: false });
  await sending;
  expect(state.fake.capabilities.send).not.toHaveBeenCalled();
  expect(state.conversation.draft()).toBe('Keep this caption');
  expect(state.conversation.file()?.name).toBe('design.pdf');
  expect(state.conversation.busy()).toBe(false);
  state.dispose();
});
