import TrashIcon from '@icon/regular/trash.svg';
import FormatIcon from '@icon/regular/text-aa.svg';
import {
  ChannelInput,
  createInputAttachmentTracker,
  useInput,
  useInputCommands,
  type InputSnapshot,
} from '../Input';
import { Message, type MessageData } from '../Message';
import { renderIcon } from '../Input/utils/render-icon';
import { InputActionButton } from '@channel/Input/PrimaryActions';
import type { MessageEditor } from './create-message-editor';

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

type InlineMessageEditorProps = {
  channelId: string;
  message: MessageData;
  snapshot: InputSnapshot;
  messageEditor: MessageEditor;
};

export function InlineMessageEditor(props: InlineMessageEditorProps) {
  const attachmentTracker = createInputAttachmentTracker({
    initialAttachments: props.snapshot.attachments,
  });

  return (
    <Message.Root message={props.message}>
      <Message.Layout>
        <div class="flex items-start gap-2">
          <Message.SenderIcon />
          <div class="flex flex-col flex-1 min-w-0 gap-2">
            <div class="flex items-center gap-2">
              <Message.SenderName />
              <Message.EditedIndicator />
              <Message.Timestamp class="ml-auto" />
            </div>
            <ChannelInput
              input={{
                mode: 'channel',
                id: `edit-message-input-${props.message.id}`,
                value: props.snapshot.value,
                attachments: props.snapshot.attachments,
                placeholder: 'Edit message',
              }}
              attachmentTracker={attachmentTracker}
              markdownNamespace={`edit-message-${props.channelId}-${props.message.id}`}
              onChange={(snapshot) =>
                props.messageEditor.update(props.message, snapshot)
              }
              onClose={() => props.messageEditor.cancel(props.message.id)}
              onSend={(snapshot) =>
                props.messageEditor.save(props.message, snapshot)
              }
              primaryActions={<EditPrimaryActions />}
            />
          </div>
        </div>
      </Message.Layout>
    </Message.Root>
  );
}
