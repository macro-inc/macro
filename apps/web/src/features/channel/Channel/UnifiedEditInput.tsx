import { Show } from 'solid-js';
import { InputFlag } from '../Input';
import type { MessageData } from '../Message';
import { useChannelParticipants } from '../use-channel-participants';
import type { MessageEditor } from './create-message-editor';
import { MessageEditorContent } from './InlineMessageEditor';

/**
 * Edit face of the unified-input mode: the inline editor's wiring
 * (`MessageEditorContent`) hosted in the floating input with a flag.
 */
export function UnifiedEditInput(props: {
  channelId: string;
  messageEditor: MessageEditor;
  onNavigateToMessage: (message: MessageData) => void;
}) {
  const participants = useChannelParticipants(() => props.channelId);

  return (
    <Show when={props.messageEditor.state()?.message} keyed>
      {(message) => (
        <div data-keep-keyboard class="w-full min-w-0 flex flex-col gap-1">
          <InputFlag
            label="Editing message"
            dismissLabel="Cancel edit"
            onActivate={() => props.onNavigateToMessage(message)}
            onDismiss={() => props.messageEditor.cancel(message.id)}
          />
          <MessageEditorContent
            channelId={props.channelId}
            message={message}
            messageEditor={props.messageEditor}
            participants={participants.users}
            collapsible
            autofocus={false}
            onReady={(handle) => {
              // Backstop focus; on mobile the action drawer's focusInput
              // machinery is the primary path.
              requestAnimationFrame(() => handle.focus());
            }}
          />
        </div>
      )}
    </Show>
  );
}
