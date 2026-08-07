import { registerHotkey } from '@core/hotkey/hotkeys';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageData } from '../../Message';
import { createThreadHotkeys } from '../create-thread-hotkeys';

vi.mock('@core/hotkey/hotkeys', () => ({
  createHotkeyGroup: () => ({
    add: vi.fn(),
    addDisposer: vi.fn(),
    dispose: vi.fn(),
  }),
  registerHotkey: vi.fn(() => ({
    dispose: vi.fn(),
    hotkey: () => undefined,
    withGroup() {
      return this;
    },
  })),
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

describe('createThreadHotkeys', () => {
  beforeEach(() => {
    vi.mocked(registerHotkey).mockClear();
  });

  it('captures repeated Enter without opening a reply from a focused thread', () => {
    const parentMessage = message();
    const onReply = vi.fn();

    const dispose = createRoot((dispose) => {
      createThreadHotkeys({
        messageListScopeId: 'channel-messages-scope',
        replySelection: {
          selectedId: () => undefined,
          select: vi.fn(),
          clear: vi.fn(),
          selectFirst: vi.fn(),
          selectPrevious: vi.fn(),
          selectNext: vi.fn(),
        },
        isThreadFocused: () => true,
        isEditing: () => false,
        activeReplies: () => [],
        threadId: () => parentMessage.id,
        getMessageActions: () => ({ onReply }),
        userId: () => 'user-1',
        parentMessage: () => parentMessage as ApiChannelMessage,
        collapseThread: vi.fn(),
        isSelected: () => true,
        hasReplies: () => false,
        expandThread: vi.fn(),
        isThreadExpanded: () => true,
        setIsReplying: vi.fn(),
      });
      return dispose;
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
    dispose();
  });
});
