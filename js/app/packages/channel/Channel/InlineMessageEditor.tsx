import TrashIcon from '@icon/regular/trash.svg';
import FormatIcon from '@icon/regular/text-aa.svg';
import {
  ChannelInput,
  createInputAttachmentTracker,
  useInput,
  useInputCommands,
} from '../Input';
import { renderIcon } from '../Input/utils/render-icon';
import { InputActionButton } from '@channel/Input/PrimaryActions';
import type { MessageEditor } from './create-message-editor';
import { useMessage } from '../Message';

function EditPrimaryActions() {
  const commands = useInputCommands();
  const input = useInput();

  return (
    <>
      <InputActionButton
        label="Format"
        active={input().showFormatRibbon}
        onClick={() => commands.toggleFormatRibbon()}
      >
        {renderIcon(FormatIcon, 'size-5')}
      </InputActionButton>
      <InputActionButton label="Discard Edit" onClick={() => commands.close()}>
        {renderIcon(TrashIcon, 'size-5')}
      </InputActionButton>
    </>
  );
}

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
      primaryActions={<EditPrimaryActions />}
    />
  );
}
