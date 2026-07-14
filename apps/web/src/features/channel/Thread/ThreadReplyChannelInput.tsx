import { useUserId } from '@core/context/user';
import { useSendMessageMutation } from '@queries/channel/message';
import { usePostTypingUpdateMutation } from '@queries/channel/typing';
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
import { useChannelParticipants } from '../use-channel-participants';
import type { FocusRequest } from './focus-request';

type ThreadReplyChannelInputProps = {
  channelId: string;
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
  const participants = useChannelParticipants(() => props.channelId);

  const tracker = createInputAttachmentTracker({
    persistenceKey: makeAttachmentTrackerPersistenceKey({
      channelId: props.channelId,
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
      attachmentTracker={tracker}
      persistenceKey={makeInputValuePersistenceKey({
        channelId: props.channelId,
        threadId: props.threadId,
      })}
      markdownNamespace={`thread-reply-input-${props.threadId}-markdown`}
      onReady={onReady}
      onChange={(snapshot) => void props.setReplyInputState(snapshot)}
      onStartTyping={() =>
        typingMutation.mutate({
          channelId: props.channelId,
          action: 'start',
          threadId: props.threadId,
        })
      }
      onStopTyping={() =>
        typingMutation.mutate({
          channelId: props.channelId,
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
          participantIds: participants.ids(),
        });

        sendMessageMutation.mutate(
          {
            channelID: props.channelId,
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
