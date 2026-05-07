import { Input, ChannelInput, createInputAttachmentTracker } from '../Input';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { MessageEditor } from './create-message-editor';
import { useMessage } from '../Message';
import { cn } from '@ui';

type MessageEditorContentProps = {
  channelId: string;
  messageEditor: MessageEditor;
  class?: string;
};

export function MessageEditorContent(props: MessageEditorContentProps) {
  const message = useMessage();
  const snapshot = () => props.messageEditor.state()?.snapshot;
  const attachmentTracker = createInputAttachmentTracker({
    initialAttachments: snapshot()?.attachments,
  });

  const [attachHotkeys, scopeId] = useHotkeyDOMScope('inline-message-editor');

  registerHotkey({
    scopeId,
    hotkey: 'escape',
    hotkeyToken: TOKENS.channel.clearSelection,
    description: 'Discard edit',
    runWithInputFocused: true,
    keyDownHandler: () => {
      props.messageEditor.cancel(message().id);
      return true;
    },
  });

  return (
    <div
      ref={attachHotkeys}
      class={cn('w-full min-w-0', props.class)}
      data-inline-input-container-id={message().id}
    >
      <ChannelInput
        input={{
          mode: 'channel',
          id: `edit-message-input-${message().id}`,
          value: snapshot()?.value,
          attachments: snapshot()?.attachments,
          placeholder: 'Edit message',
        }}
        attachmentTracker={attachmentTracker}
        markdownNamespace={`edit-message-${props.channelId}-${message().id}`}
        onChange={(nextSnapshot) =>
          props.messageEditor.update(message(), nextSnapshot)
        }
        onClose={() => props.messageEditor.cancel(message().id)}
        onSend={(nextSnapshot) =>
          props.messageEditor.save(message(), nextSnapshot)
        }
      >
        <Input.Actions>
          <Input.Actions.Left>
            <Input.ToggleFormatAction />
            <Input.DiscardDraftAction />
          </Input.Actions.Left>
          <Input.Actions.Right>
            <Input.SendAction />
          </Input.Actions.Right>
        </Input.Actions>
      </ChannelInput>
    </div>
  );
}
