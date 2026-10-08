import { createChannelMessageActions } from '@channel/Channel/create-channel-message-actions';
import { createDeleteMessageConfirmation } from '@channel/Channel/create-delete-message-confirmation';
import { createMessageEditor } from '@channel/Channel/create-message-editor';
import type { InputHandle, InputSnapshot } from '@channel/Input';
import { MaybeMessageActionDrawerManager } from '@channel/Mobile/MessageActionDrawerManager';
import { ChannelThread } from '@channel/Thread/ChannelThread';
import { createFocusRequest } from '@channel/Thread/focus-request';
import { buildMessageLink } from '@channel/Thread/utils/message-actions';
import { useUserId } from '@core/context/user';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import {
  useDeleteMessageMutation,
  usePatchMessageMutation,
} from '@queries/messages/mutations';
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '@queries/messages/reactions';
import { useMessageThreadQuery } from '@queries/messages/thread-replies';
import type {
  MessageListItem,
  MessageParent,
  MessageThread as ThreadData,
} from '@service-storage/messages';
import { createSignal, Show } from 'solid-js';
import type { MessageActionHandler, MessageData } from './types';

export function threadListItem(thread: ThreadData): MessageListItem {
  return {
    ...thread.root,
    state: thread.state,
    thread: {
      reply_count: thread.replies.length,
      // Replies are stored oldest-first; preview the latest three, as channels do.
      preview: thread.replies.slice(-3),
      latest_reply_at: thread.replies.at(-1)?.created_at ?? null,
    },
  };
}

type ThreadOptions = {
  canWrite: boolean;
  /** Delete comments the caller did not write. Document owners set this. */
  canModerate?: boolean;
  buildLink?: (message: MessageData) => string;
  targetId?: string | null;
  /** Change this key to navigate to the same target again. */
  targetRequestKey?: string | number;
  /** Releases the highlight on `targetId`; called when the linked message is clicked. */
  onClearTarget?: () => void;
  expanded?: boolean;
  hideReplyInput?: boolean;
  /** Keep the inline composer visible without focusing it on mount. */
  keepReplyInputOpen?: boolean;
  /** Display the latest two replies with an earlier-replies disclosure. */
  collapsedReplyPreview?: 'latest-two';
  /** Reply through a composer owned by the enclosing surface. */
  onReply?: MessageActionHandler;
  hideRail?: boolean;
  onEditingChange?: (id: string, editing: boolean) => void;
  monorail?: boolean;
};

/** Document and source-channel threads compose the existing channel thread and message controls. */
export function MessageThread(
  props: ThreadOptions & { data: MessageListItem }
) {
  const userId = useUserId();
  const [expanded, setExpanded] = createSignal(props.expanded ?? false);
  const [replying, setReplying] = createSignal(false);
  const [draft, setDraft] = createSignal<InputSnapshot>();
  const [handle, setHandle] = createSignal<InputHandle>();
  const [attachScope, scopeId] = useHotkeyDOMScope('message-thread');
  const focus = createFocusRequest();
  const remove = useDeleteMessageMutation();
  const confirm = createDeleteMessageConfirmation(remove.mutate);
  const patch = usePatchMessageMutation();
  const addReaction = useAddReactionMutation();
  const removeReaction = useRemoveReactionMutation();
  const editor = createMessageEditor({
    parent: () => props.data.parent,
    patchMessage: patch.mutate,
    onEditEnded: (message) => props.onEditingChange?.(message.id, false),
  });
  const actions = createChannelMessageActions({
    parent: () => props.data.parent,
    userId,
    canWrite: () => props.canWrite,
    canModerate: () => props.canModerate ?? false,
    buildLink: (message) =>
      message.parent?.type === 'channel'
        ? buildMessageLink(message.parent.id, message.id, message.thread_id)
        : (props.buildLink?.(message) ?? window.location.href),
    deleteMessage: confirm.requestDelete,
    addReaction: addReaction.mutate,
    removeReaction: removeReaction.mutate,
    onEdit: ({ message }) => {
      editor.start(message);
      props.onEditingChange?.(message.id, true);
    },
    onReply: (context) => {
      if (props.onReply) return props.onReply(context);
      if (!props.keepReplyInputOpen) setExpanded(true);
      setReplying(true);
      focus.request();
    },
  });
  return (
    <MaybeMessageActionDrawerManager>
      <div
        ref={attachScope}
        data-message-thread={props.data.id}
        class="relative isolate"
      >
        <confirm.ConfirmationDialog />
        <ChannelThread
          data={() => props.data}
          parent={() => props.data.parent}
          getMessageActions={(message) => {
            const value = actions(message);
            return props.hideReplyInput && !props.onReply
              ? { ...value, onReply: undefined }
              : value;
          }}
          messageEditor={props.canWrite ? editor : undefined}
          isExpanded={() => expanded() || !!props.targetId}
          setIsExpanded={setExpanded}
          isReplying={() =>
            props.canWrite &&
            !props.hideReplyInput &&
            (replying() || !!props.keepReplyInputOpen)
          }
          setIsReplying={setReplying}
          keepReplyInputOpen={props.keepReplyInputOpen}
          collapsedReplyPreview={props.collapsedReplyPreview}
          replyInputState={draft}
          setReplyInputState={setDraft}
          replyInputHandle={handle}
          setReplyInputHandle={setHandle}
          replyInputFocusRequest={focus}
          isFindBarOpen={() => false}
          monorail={props.monorail}
          hideRail={props.hideRail}
          messageListScopeId={scopeId}
          selectedMessageId={() => (props.targetId ? props.data.id : undefined)}
          targetNavigation={{
            requestKey: () => props.targetRequestKey,
            targetThreadId: () => (props.targetId ? props.data.id : undefined),
            targetMessageId: () => props.targetId ?? undefined,
            targetReplyId: () =>
              props.targetId && props.targetId !== props.data.id
                ? props.targetId
                : undefined,
            activeTargetReplyId: () =>
              props.targetId && props.targetId !== props.data.id
                ? props.targetId
                : undefined,
            positionTarget: (_row, target) => {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return true;
            },
            onTargetMessageScrolled: () => {},
            onTargetReplyScrolled: () => {},
            onClearTarget: () => {
              // The link expanded the thread; releasing its highlight keeps
              // the thread open rather than collapsing the replies in view.
              setExpanded(true);
              props.onClearTarget?.();
            },
          }}
        />
      </div>
    </MaybeMessageActionDrawerManager>
  );
}

/** An anchor or a linked drawer knows a root identity; it reads the same cached thread. */
export function MessageThreadById(
  props: ThreadOptions & { parent: MessageParent; rootId: string }
) {
  const query = useMessageThreadQuery(
    () => props.parent,
    () => props.rootId
  );
  return (
    <Show
      when={query.isSuccess && !query.data.state.deleted_at}
      fallback={
        <Show when={query.isError}>
          <button onClick={() => void query.refetch()}>
            Could not load thread. Retry
          </button>
        </Show>
      }
    >
      <MessageThread
        {...props}
        data={threadListItem(query.data!)}
        expanded={props.expanded ?? true}
      />
    </Show>
  );
}
