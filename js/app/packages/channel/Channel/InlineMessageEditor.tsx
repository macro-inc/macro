import { Input, ChannelInput, createInputAttachmentTracker } from '../Input';
import type { MessageEditor } from './create-message-editor';
import { useMessage } from '../Message';

type MessageEditorContentProps = {
  channelId: string;
  messageEditor: MessageEditor;
};

export function MessageEditorContent(props: MessageEditorContentProps) {
  const message = useMessage();
  const snapshot = () => props.messageEditor.state()?.snapshot;
  const attachmentTracker = createInputAttachmentTracker({
    initialAttachments: snapshot()?.attachments,
  });

  return (
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
  );
}
