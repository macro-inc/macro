import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, onMount, Show } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { MessageData } from '../../Message';
import { createChannelHotkeys } from '../create-channel-hotkeys';

const originalMessage: MessageData = {
  id: 'message-1',
  content: 'before edit',
  sender_id: 'user-1',
  created_at: '2026-08-07T00:00:00.000Z',
  updated_at: '2026-08-07T00:00:00.000Z',
  attachments: [],
  reactions: [],
};

function TestMessageEditor(props: { onSave: () => void }) {
  const [attachEditorHotkeys] = useHotkeyDOMScope('message-editor');
  let editor!: HTMLDivElement;

  onMount(() => editor.focus());

  return (
    <div
      ref={(element) => {
        editor = element;
        attachEditorHotkeys(element);
      }}
      contenteditable
      data-testid="message-editor"
      onKeyDown={(event) => {
        if (event.key === 'Enter') props.onSave();
      }}
    />
  );
}

function ChannelEditHarness(props: {
  onSave: ReturnType<typeof vi.fn>;
  onReply: ReturnType<typeof vi.fn>;
}) {
  useHotKeyRoot();

  const [isEditing, setIsEditing] = createSignal(false);

  const { attachMessageListRef } = createChannelHotkeys({
    selection: {
      selectedId: () => originalMessage.id,
      select: vi.fn(),
      clear: vi.fn(),
      selectFirst: vi.fn(),
      selectPrevious: vi.fn(),
      selectNext: vi.fn(),
    },
    navigation: () => undefined,
    messageById: () =>
      new Map([[originalMessage.id, originalMessage as ApiChannelMessage]]),
    getMessageActions: () => ({
      onEdit: () => {
        setIsEditing(true);
      },
      onReply: props.onReply,
    }),
    userId: () => 'user-1',
    isInputEmpty: () => true,
    isEditing,
    onOpenFindBar: vi.fn(),
    onGoToBottom: vi.fn(),
  });

  return (
    <div ref={attachGlobalDOMScope}>
      <div ref={attachMessageListRef} tabIndex={-1} data-testid="message-list">
        <div data-message data-message-id={originalMessage.id}>
          <div data-message-content>
            <div data-message-reply-preview="Resolved bot response">
              Resolved bot response
            </div>
          </div>
        </div>
        <Show when={isEditing()}>
          <TestMessageEditor
            onSave={() => {
              props.onSave();
              setIsEditing(false);
            }}
          />
        </Show>
      </div>
    </div>
  );
}

describe('createChannelHotkeys', () => {
  it('does not turn the Enter that saves an edit into a reply', () => {
    const onSave = vi.fn();
    const onReply = vi.fn();
    render(() => <ChannelEditHarness onSave={onSave} onReply={onReply} />);

    const messageList = screen.getByTestId('message-list');
    messageList.focus();

    fireEvent.keyDown(messageList, { key: 'e' });
    const editor = screen.getByTestId('message-editor');
    expect(document.activeElement).toBe(editor);

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('message-editor')).toBeNull();
    expect(document.activeElement).toBe(messageList);

    fireEvent.keyDown(messageList, { key: 'Enter', repeat: true });
    expect(onReply).not.toHaveBeenCalled();
  });

  it('does not turn a straggler keyup after saving an edit into a reply', () => {
    const onSave = vi.fn();
    const onReply = vi.fn();
    render(() => <ChannelEditHarness onSave={onSave} onReply={onReply} />);

    const messageList = screen.getByTestId('message-list');
    messageList.focus();

    fireEvent.keyDown(messageList, { key: 'e' });
    const editor = screen.getByTestId('message-editor');
    expect(document.activeElement).toBe(editor);

    // Fast typing rolls over: Enter goes down before the last typed letter
    // is released, so the letter's keyup lands after the editor closed and
    // focus returned to the message list — with 'enter' still pressed.
    fireEvent.keyDown(editor, { key: 'd' });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(messageList);

    fireEvent.keyUp(messageList, { key: 'd' });
    fireEvent.keyUp(messageList, { key: 'Enter' });
    expect(onReply).not.toHaveBeenCalled();
  });

  it('passes resolved decorator text when Enter opens a reply', () => {
    const onSave = vi.fn();
    const onReply = vi.fn();
    render(() => <ChannelEditHarness onSave={onSave} onReply={onReply} />);

    const messageList = screen.getByTestId('message-list');
    messageList.focus();
    fireEvent.keyDown(messageList, { key: 'Enter' });

    expect(onReply).toHaveBeenCalledWith(
      expect.objectContaining({
        message: originalMessage,
        renderedText: 'Resolved bot response',
      })
    );
  });
});
