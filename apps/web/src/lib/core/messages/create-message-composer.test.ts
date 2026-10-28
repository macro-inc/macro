import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createMessageComposer } from './create-message-composer';

it('retains the complete draft after a failed send and clears it after a successful retry', async () => {
  let dispose!: () => void;
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  const clearEditor = vi.fn();
  const onSendError = vi.fn();
  const composer = createRoot((cleanup) => {
    dispose = cleanup;
    return createMessageComposer({
      input: {
        mode: 'channel',
        value: 'Ask @agent',
        attachments: [{ id: 'doc', kind: 'document', name: 'Document' }],
      },
      callbacks: { onSend: send },
      clearEditor,
      attachFiles: async () => {},
      onSendError,
    });
  });
  clearEditor.mockImplementation(() => composer.onChange('\n \n'));
  try {
    composer.mentionsTracker.onMentionCreate({
      itemType: 'user',
      itemId: 'bot|00000000-0000-0000-0000-00000000a1a1',
    });
    const draft = composer.inputState.snapshot();
    expect(await composer.inputState.commands.send()).toBe(false);
    expect(composer.inputState.snapshot()).toEqual(draft);
    // The box clears before delivery so a successful send cannot leave a
    // second copy behind; a failure puts that same draft back.
    expect(clearEditor).toHaveBeenCalledOnce();
    expect(onSendError).toHaveBeenCalledOnce();
    expect(await composer.inputState.commands.send()).toBe(true);
    expect(send).toHaveBeenLastCalledWith(draft);
    const cleared = composer.inputState.snapshot();
    expect(cleared.value.trim()).toBe('');
    expect(cleared.attachments).toEqual([]);
    expect(cleared.mentions).toEqual([]);
    expect(clearEditor).toHaveBeenCalledTimes(2);
  } finally {
    dispose();
  }
});

it('does not dispatch a second send while the first one is pending', async () => {
  let finish!: () => void;
  let dispose!: () => void;
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const composer = createRoot((cleanup) => {
    dispose = cleanup;
    return createMessageComposer({
      input: { mode: 'channel', value: 'message' },
      callbacks: { onSend: send },
      clearEditor: () => {},
      attachFiles: async () => {},
    });
  });
  try {
    const sending = composer.inputState.commands.send();
    expect(await composer.inputState.commands.send()).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    finish();
    expect(await sending).toBe(true);
  } finally {
    dispose();
  }
});

it('preserves a new draft typed while a failed send is pending', async () => {
  let rejectSend!: (error: Error) => void;
  let dispose!: () => void;
  const restoreEditor = vi.fn();
  const composer = createRoot((cleanup) => {
    dispose = cleanup;
    return createMessageComposer({
      input: { mode: 'channel', value: 'first message' },
      callbacks: {
        onSend: () =>
          new Promise<void>((_resolve, reject) => {
            rejectSend = reject;
          }),
      },
      clearEditor: () => {},
      restoreEditor,
      attachFiles: async () => {},
      onSendError: vi.fn(),
    });
  });
  try {
    const sending = composer.inputState.commands.send();
    composer.onChange('next message');
    composer.attachmentTracker.setAttachments([
      { id: 'next-doc', kind: 'document', name: 'Document' },
    ]);
    rejectSend(new Error('offline'));
    expect(await sending).toBe(false);
    expect(composer.inputState.snapshot()).toEqual({
      value: 'next message',
      attachments: [{ id: 'next-doc', kind: 'document', name: 'Document' }],
      mentions: [],
    });
    expect(restoreEditor).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});
