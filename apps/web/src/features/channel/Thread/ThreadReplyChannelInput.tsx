import { useUserId } from '@core/context/user';
import { useSendMessageMutation } from '@queries/messages/mutations';
import { usePostTypingUpdateMutation } from '@queries/messages/typing';
import type { MessageParent } from '@service-storage/messages';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  type Setter,
} from 'solid-js';
import type { InputHandle, InputSnapshot } from '../Input';
import { ChannelInput, createInputAttachmentTracker } from '../Input';
import { buildPostMessageSendPayload } from '../Input/message-payload';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
} from '../Input/utils/persistence';
import { hasSendableInputContent } from '../Input/utils/sendable-content';
import { useMessageBotMentionUsers } from '../use-channel-bot-mention-users';
import { useChannelParticipants } from '../use-channel-participants';
import type { FocusRequest } from './focus-request';

type ThreadReplyChannelInputProps = {
  parent: MessageParent;
  threadId: string;
  replyInputState: Accessor<InputSnapshot | undefined>;
  setReplyInputState: Setter<InputSnapshot | undefined>;
  /**
   * Shared handle slot from `ThreadState`; used to restore a failed send's
   * draft into whichever reply input is mounted by then.
   */
  replyInputHandle?: Accessor<InputHandle | undefined>;
  setReplyInputHandle?: Setter<InputHandle | undefined>;
  focusRequest?: FocusRequest;
  /** Exit reply mode. Called on close and (immediately) on send. */
  onExit: () => void;
  /** Where the reply input is hosted. Defaults to 'inline' (in the thread). */
  host?: 'inline' | 'unified';
  collapsible?: boolean;
  /** Observe the mounted input's handle (e.g. for entity drops). */
  onReady?: (handle: InputHandle) => void;
};

/**
 * The wired `ChannelInput` for thread replies: draft registration and
 * restore, focus requests, typing signals, and the send pipeline. Shared by
 * the inline `ThreadReplyInput` and the unified-input mode's
 * `UnifiedReplyInput`, which only differ in the chrome around it.
 */
export function ThreadReplyChannelInput(props: ThreadReplyChannelInputProps) {
  onCleanup(() => {
    props.setReplyInputHandle?.(undefined);
  });

  const userId = useUserId();
  const sendMessageMutation = useSendMessageMutation();
  const typingMutation = usePostTypingUpdateMutation();
  const participants = useChannelParticipants(() =>
    props.parent.type === 'channel' ? props.parent.id : ''
  );
  const channelBotMentionUsers = useMessageBotMentionUsers(() => props.parent);

  const tracker = createInputAttachmentTracker({
    persistenceKey: makeAttachmentTrackerPersistenceKey({
      channelId: `${props.parent.type}:${props.parent.id}`,
      threadId: props.threadId,
    }),
    initialAttachments: props.replyInputState()?.attachments,
  });

  const [replyInputHandle, setLocalReplyInputHandle] =
    createSignal<InputHandle>();

  const focusIfRequested = () => {
    const handle = replyInputHandle();
    if (!handle) return;
    if (!props.focusRequest?.consume()) return;

    handle.focus();
  };

  createEffect(() => {
    props.focusRequest?.pending();
    focusIfRequested();
  });

  const onReady = (handle: InputHandle) => {
    setLocalReplyInputHandle(handle);
    props.setReplyInputHandle?.(handle);
    props.onReady?.(handle);

    const snapshot = props.replyInputState();
    requestAnimationFrame(() => {
      if (snapshot) handle.restoreSnapshot(snapshot, { focus: false });
      focusIfRequested();
    });
  };

  return (
    <ChannelInput
      parent={props.parent}
      input={{
        id: `thread-reply-input-${props.threadId}`,
        placeholder: 'Send a reply',
        value: props.replyInputState()?.value,
        attachments: props.replyInputState()?.attachments,
        mode: 'reply',
        host: props.host,
      }}
      collapsible={props.collapsible}
      autofocus={false}
      participants={participants.users}
      bots={channelBotMentionUsers}
      attachmentTracker={tracker}
      persistenceKey={makeInputValuePersistenceKey({
        channelId: `${props.parent.type}:${props.parent.id}`,
        threadId: props.threadId,
      })}
      markdownNamespace={`thread-reply-input-${props.threadId}-markdown`}
      onReady={onReady}
      onChange={(snapshot) => void props.setReplyInputState(snapshot)}
      onStartTyping={() =>
        typingMutation.mutate({
          parent: props.parent,
          action: 'start',
          threadId: props.threadId,
        })
      }
      onStopTyping={() =>
        typingMutation.mutate({
          parent: props.parent,
          action: 'stop',
          threadId: props.threadId,
        })
      }
      onClose={() => {
        props.setReplyInputState(undefined);
        props.onExit();
      }}
      onSend={(snapshot) => {
        const senderId = userId();
        if (!senderId) return;
        const payload = buildPostMessageSendPayload({
          snapshot,
          threadId: props.threadId,
        });

        sendMessageMutation.mutate(
          {
            parent: props.parent,
            senderId,
            optimisticId: crypto.randomUUID(),
            ...payload,
          },
          {
            onError: () => {
              // The user may have started a new draft by now; keep it.
              const current = props.replyInputState();
              if (current && hasSendableInputContent(current)) return;
              props.setReplyInputState(snapshot);
              props.replyInputHandle?.()?.restoreSnapshot(snapshot, {
                focus: false,
              });
            },
          }
        );

        // Exit right away — the send is optimistic; the mutation's failure
        // toast plus the draft restore above cover the error case.
        props.setReplyInputState(undefined);
        props.onExit();
      }}
    />
  );
}
