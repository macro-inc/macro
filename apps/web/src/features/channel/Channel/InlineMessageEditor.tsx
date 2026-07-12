import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { IUser } from '@core/user/types';
import { cn } from '@ui';
import type { Accessor } from 'solid-js';
import {
  ChannelInput,
  createInputAttachmentTracker,
  Input,
  type InputHandle,
} from '../Input';
import type { MessageData } from '../Message';
import type { MessageEditor } from './create-message-editor';

type MessageEditorContentProps = {
  channelId: string;
  message: MessageData;
  messageEditor: MessageEditor;
  participants?: Accessor<IUser[]>;
  class?: string;
  collapsible?: boolean;
  /** Defaults to `!isMobile()` inside `ChannelInput`. */
  autofocus?: boolean;
  onReady?: (handle: InputHandle) => void;
};

/**
 * The wired `ChannelInput` for editing a message. Shared by the inline
 * message editor and the unified-input mode's `UnifiedEditInput`, which only
 * differ in the chrome around it.
 */
export function MessageEditorContent(props: MessageEditorContentProps) {
  const snapshot = () => props.messageEditor.state()?.snapshot;
  const attachmentTracker = createInputAttachmentTracker({
    initialAttachments: snapshot()?.attachments,
  });

  const [attachHotkeys, scopeId] = useHotkeyDOMScope('message-editor');

  registerHotkey({
    scopeId,
    hotkey: 'escape',
    hotkeyToken: TOKENS.channel.clearSelection,
    description: 'Discard edit',
    runWithInputFocused: true,
    keyDownHandler: () => {
      props.messageEditor.cancel(props.message.id);
      return true;
    },
  });

  return (
    <div ref={attachHotkeys} class={cn('w-full min-w-0', props.class)}>
      <ChannelInput
        input={{
          mode: 'channel',
          id: `edit-message-input-${props.message.id}`,
          value: snapshot()?.value,
          attachments: snapshot()?.attachments,
          placeholder: 'Edit message',
        }}
        collapsible={props.collapsible}
        autofocus={props.autofocus}
        attachmentTracker={attachmentTracker}
        participants={props.participants}
        markdownNamespace={`edit-message-${props.channelId}-${props.message.id}`}
        onReady={props.onReady}
        onChange={(nextSnapshot) =>
          props.messageEditor.update(props.message, nextSnapshot)
        }
        onClose={() => props.messageEditor.cancel(props.message.id)}
        onSend={(nextSnapshot) =>
          props.messageEditor.save(props.message, nextSnapshot)
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
