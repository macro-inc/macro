import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGettingStartedChatOpener } from './getting-started-chat';
import { createGettingStartedState } from './getting-started-state';

describe('getting started chats', () => {
  beforeEach(() => localStorage.clear());

  const setup = (userId = 'user-1') => {
    const state = createGettingStartedState(userId);
    const startChat = vi
      .fn<(prompt: string) => Promise<string | undefined>>()
      .mockResolvedValue('chat-1');
    const openChat = vi.fn();
    const activate = createGettingStartedChatOpener({
      state,
      startChat,
      openChat,
    });
    return { state, startChat, openChat, activate };
  };

  it('reopens the saved chat after remounting without resending the prompt', async () => {
    const first = setup();
    await first.activate('example-weekly-brief', 'Build my weekly brief');
    first.state.markCompleted('example-weekly-brief');
    first.state.toggleSection('basics');

    const reopened = setup();
    expect(
      await reopened.activate('example-weekly-brief', 'Updated prompt')
    ).toBe(true);
    expect(reopened.startChat).not.toHaveBeenCalled();
    expect(reopened.openChat).toHaveBeenCalledWith('chat-1');
    expect(first.startChat).toHaveBeenCalledExactlyOnceWith(
      'Build my weekly brief'
    );
  });

  it('keeps chats separate for each button and account', async () => {
    const first = setup();
    first.startChat
      .mockResolvedValueOnce('chat-1')
      .mockResolvedValueOnce('chat-2');
    await first.activate('example-weekly-brief', 'Brief');
    await first.activate('example-pull-tasks', 'Tasks');
    await first.activate('example-weekly-brief', 'Brief');
    await first.activate('example-pull-tasks', 'Tasks');
    expect(first.startChat).toHaveBeenCalledTimes(2);
    expect(first.openChat.mock.calls).toEqual([
      ['chat-1'],
      ['chat-2'],
      ['chat-1'],
      ['chat-2'],
    ]);

    const other = setup('user-2');
    await other.activate('example-weekly-brief', 'Brief');
    expect(other.startChat).toHaveBeenCalledOnce();
  });

  it('ignores repeated clicks while creating the chat', async () => {
    const { startChat, openChat, activate } = setup();
    let finish!: (chatId: string) => void;
    startChat.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const first = activate('example-weekly-brief', 'Brief');
    expect(await activate('example-weekly-brief', 'Brief')).toBe(false);
    finish('chat-1');
    expect(await first).toBe(true);
    expect(await activate('example-weekly-brief', 'Brief')).toBe(true);
    expect(startChat).toHaveBeenCalledOnce();
    expect(openChat.mock.calls).toEqual([['chat-1'], ['chat-1']]);
  });

  it('allows retrying failed creation', async () => {
    const { state, startChat, activate } = setup();
    startChat.mockResolvedValueOnce(undefined);
    expect(await activate('example-weekly-brief', 'Brief')).toBe(false);
    expect(state.chatIdForAction('example-weekly-brief')).toBeUndefined();
    expect(await activate('example-weekly-brief', 'Brief')).toBe(true);
    expect(startChat).toHaveBeenCalledTimes(2);
  });

  it('clears the pending guard if creation throws', async () => {
    const { startChat, activate } = setup();
    startChat.mockRejectedValueOnce(new Error('Network failure'));
    expect(await activate('example-weekly-brief', 'Brief')).toBe(false);
    expect(await activate('example-weekly-brief', 'Brief')).toBe(true);
  });
});
