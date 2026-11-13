import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { useMessageTransport } from '@core/messages/message-transport';
import { isMobile } from '@core/mobile/isMobile';
import { isPlatform } from '@core/util/platform';
import type { MessageParent } from '@service-storage/messages';
import { cn } from '@ui';
import { Show } from 'solid-js';
import {
  ChannelInput,
  createInputAttachmentTracker,
  Input,
  type InputHandle,
} from '../Input';
import type { MessageData } from '../Message';
import { useMessageBotMentionUsers } from '../use-channel-bot-mention-users';
import type { MessageEditor } from './create-message-editor';

type MessageEditorContentProps = {
  parent: MessageParent;
  message: MessageData;
  messageEditor: MessageEditor;
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
  const guestTransport = useMessageTransport();
  const snapshot = () => props.messageEditor.state()?.snapshot;
  const channelBotMentionUsers = guestTransport
    ? () => []
    : useMessageBotMentionUsers(() => props.parent);
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
        parent={props.parent}
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
        bots={channelBotMentionUsers}
        features={
          guestTransport
            ? {
                mentions: false,
                createItems: false,
                gifs: false,
                richBlocks: false,
                attachments: false,
                dictation: false,
              }
            : undefined
        }
        markdownNamespace={`edit-message-${props.parent.type}:${props.parent.id}-${props.message.id}`}
        onReady={props.onReady}
        onChange={(nextSnapshot) =>
          props.messageEditor.update(props.message, nextSnapshot)
        }
        onClose={() => props.messageEditor.cancel(props.message.id)}
        onSend={(nextSnapshot) =>
          props.messageEditor.save(props.message, nextSnapshot)
        }
      >
        {(addMenu) => (
          <>
            <Input.Layout.ActionsLeft>
              <Show
                when={isMobile()}
                fallback={
                  <Show
                    when={isPlatform('ios')}
                    fallback={
                      <Show when={!guestTransport}>
                        <Input.AttachFilesAction />
                      </Show>
                    }
                  >
                    <Show when={!guestTransport}>
                      <Input.AttachNativeMediaAction />
                    </Show>
                  </Show>
                }
              >
                <Show when={!guestTransport}>{addMenu}</Show>
              </Show>
              <Input.DiscardDraftAction />
            </Input.Layout.ActionsLeft>
            <Input.Layout.ActionsRight>
              <Input.SendAction />
            </Input.Layout.ActionsRight>
          </>
        )}
      </ChannelInput>
    </div>
  );
}
