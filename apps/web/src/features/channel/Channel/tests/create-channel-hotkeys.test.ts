import { registerHotkey } from '@core/hotkey/hotkeys';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageData } from '../../Message';
import { createChannelHotkeys } from '../create-channel-hotkeys';

vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: vi.fn((prefix: string) => [vi.fn(), `${prefix}-scope`]),
}));

function message(): MessageData {
  return {
    id: 'message-1',
    content: 'hello',
    sender_id: 'user-1',
    created_at: '2026-08-07T00:00:00.000Z',
    updated_at: '2026-08-07T00:00:00.000Z',
    attachments: [],
    reactions: [],
  };
}

describe('createChannelHotkeys', () => {
  beforeEach(() => {
    vi.mocked(registerHotkey).mockClear();
  });

  it('captures repeated Enter without opening a reply for a selected message', () => {
    const selectedMessage = message();
    const onReply = vi.fn();

    createChannelHotkeys({
      selection: {
        selectedId: () => selectedMessage.id,
        select: vi.fn(),
        clear: vi.fn(),
        selectFirst: vi.fn(),
        selectPrevious: vi.fn(),
        selectNext: vi.fn(),
      },
      navigation: () => undefined,
      messageById: () =>
        new Map([[selectedMessage.id, selectedMessage as ApiChannelMessage]]),
      getMessageActions: () => ({ onReply }),
      userId: () => 'user-1',
      isInputEmpty: () => true,
      isEditing: () => false,
      onOpenFindBar: vi.fn(),
      onGoToBottom: vi.fn(),
    });

    const registration = vi
      .mocked(registerHotkey)
      .mock.calls.map(([options]) => options)
      .find(
        (options) =>
          options.scopeId === 'channel-messages-scope' &&
          options.hotkey === 'enter'
      );
    const repeatedEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      repeat: true,
    });

    expect(registration?.keyDownHandler(repeatedEnter)).toBe(true);
    expect(onReply).not.toHaveBeenCalled();

    expect(registration?.keyDownHandler()).toBe(true);
    expect(onReply).toHaveBeenCalledOnce();
  });
});
