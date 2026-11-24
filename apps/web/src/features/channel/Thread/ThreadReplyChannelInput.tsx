import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  newMessageId,
  useSendMessageMutation,
} from '@queries/messages/mutations';
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
import { hasSendableInputContent } from '../Input/utils/sendable-content';
import { createUncertainSends } from '../Input/utils/uncertain-sends';
import { useMessageBotMentionUsers } from '../use-channel-bot-mention-users';
import type { FocusRequest } from './focus-request';
import {
  registerReplyInput,
  replyDraftKeys,
  restoreFailedReply,
} from './reply-drafts';

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
  mode?: 'channel' | 'reply';
  placeholder?: string;
  /** Observe the mounted input's handle (e.g. for entity drops). */
  onReady?: (handle: InputHandle) => void;
};

/**
 * The wired `ChannelInput` for thread replies: draft registration and
 * restore, focus requests, typing signals, and the send pipeline. Shared by
 * the inline `ThreadReplyInput` and the unified-input mode's
 * `UnifiedReplyInput`, which only differ in the chrome around it.
 */
/**
 * Snapshots a reply input reported of its own draft. The stored draft already
 * holds that text, or newer text from the same thread open in another tab, so
 * a remount restores only snapshots built elsewhere, such as a quote reply.
 */
const REPORTED_SNAPSHOTS = new WeakSet<InputSnapshot>();

/**
 * The reply input unmounts as it sends, so the reply whose delivery is
 * unknown is remembered here, with where it went.
 */
const UNCERTAIN_REPLIES = createUncertainSends(() => newMessageId());

/** Sends a reply, handing a failure to `onFailed`; the mutation toasts it. */
async function sendReply(
  send: () => Promise<unknown>,
  onFailed: (error: unknown) => void
): Promise<void> {
  try {
    await send();
  } catch (error) {
    onFailed(error);
  }
}

export function ThreadReplyChannelInput(props: ThreadReplyChannelInputProps) {
  onCleanup(() => {
    props.setReplyInputHandle?.(undefined);
  });

  const userId = useUserId();
  const sendMessageMutation = useSendMessageMutation();
  const typingMutation = usePostTypingUpdateMutation();
  const channelBotMentionUsers = useMessageBotMentionUsers(() => props.parent);

  const pendingSnapshot = () => {
    const snapshot = props.replyInputState();
    return snapshot && !REPORTED_SNAPSHOTS.has(snapshot) ? snapshot : undefined;
  };

  const draftKeys = () => replyDraftKeys(props.parent, props.threadId);

  const tracker = createInputAttachmentTracker({
    persistenceKey: draftKeys().attachments,
    initialAttachments: pendingSnapshot()?.attachments,
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

  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());

  const onReady = (handle: InputHandle) => {
    unregister?.();
    unregister = registerReplyInput(draftKeys(), handle);
    setLocalReplyInputHandle(handle);
    props.setReplyInputHandle?.(handle);
    props.onReady?.(handle);

    const snapshot = pendingSnapshot();
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
        placeholder: props.placeholder ?? 'Send a reply',
        value: pendingSnapshot()?.value,
        attachments: pendingSnapshot()?.attachments,
        mode: props.mode ?? 'reply',
        host: props.host,
      }}
      collapsible={props.collapsible}
      autofocus={false}
      bots={channelBotMentionUsers}
      attachmentTracker={tracker}
      persistenceKey={draftKeys().text}
      markdownNamespace={`thread-reply-input-${props.threadId}-markdown`}
      onReady={onReady}
      onChange={(snapshot) => {
        REPORTED_SNAPSHOTS.add(snapshot);
        props.setReplyInputState(snapshot);
        const senderId = userId();
        if (!senderId || !hasSendableInputContent(snapshot)) return;
        const { message } = buildPostMessageSendPayload({
          snapshot,
          threadId: props.threadId,
        });
        UNCERTAIN_REPLIES.drafted({ senderId, parent: props.parent, message });
      }}
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
      onEscape={() => {
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
        // Who sends it, where it goes and what it says: the same text in
        // another thread, or from another account, is another message.
        const uncertainKey = {
          senderId,
          parent: props.parent,
          message: payload.message,
        };
        const optimisticId = UNCERTAIN_REPLIES.idFor(uncertainKey);
        const keys = draftKeys();
        // Awaited, not `mutate`'s per-call `onError`: the input unmounts as
        // it sends, and TanStack drops a call's callbacks once its observer
        // is gone, which would lose the draft.
        fireAndForget(
          sendReply(
            () =>
              sendMessageMutation.mutateAsync({
                parent: props.parent,
                senderId,
                optimisticId,
                ...payload,
              }),
            (error) => {
              // Through the thread's stored draft, not this view's state: the
              // view may be gone, and another may hold a newer draft.
              if (!restoreFailedReply(keys, snapshot)) return;
              // Sent again unchanged, a reply that may have arrived keeps its id.
              UNCERTAIN_REPLIES.restored(uncertainKey, optimisticId, error);
            }
          ),
          'thread-reply-input'
        );

        // Exit right away — the send is optimistic; the mutation's failure
        // toast plus the draft restore above cover the error case.
        props.setReplyInputState(undefined);
        props.onExit();
      }}
    />
  );
}
