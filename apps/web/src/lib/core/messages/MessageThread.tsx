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
  useDeleteThreadMutation,
  usePatchMessageMutation,
  usePatchThreadMutation,
} from '@queries/messages/mutations';
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '@queries/messages/reactions';
import { useMessageSubscription } from '@queries/messages/subscription';
import { useMessageThreadQuery } from '@queries/messages/thread-replies';
import { useMessageTimelineByIdsQuery } from '@queries/messages/timeline';
import type {
  MessageListItem,
  MessageParent,
  MessageThread as ThreadData,
} from '@service-storage/messages';
import { createSignal, Show } from 'solid-js';
import type { MessageData } from './types';

export function threadListItem(thread: ThreadData): MessageListItem {
  return {
    ...thread.root,
    state: thread.state,
    thread: {
      reply_count: thread.replies.length,
      preview: thread.replies.slice(0, 3),
      latest_reply_at: thread.replies.at(-1)?.created_at ?? null,
    },
  };
}

type ThreadOptions = {
  canWrite: boolean;
  canManage?: boolean;
  buildLink?: (message: MessageData) => string;
  targetId?: string | null;
  expanded?: boolean;
  hideReplyInput?: boolean;
  onEditingChange?: (id: string, editing: boolean) => void;
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
  const patchThread = usePatchThreadMutation();
  const deleteThread = useDeleteThreadMutation();
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
    onReply: () => {
      setExpanded(true);
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
        <Show when={props.data.parent.type === 'document'}>
          <div class="mb-5 flex items-center justify-end gap-3 text-xs text-ink-muted touch:mb-0">
            <Show when={props.data.state.resolved}>
              <span>Resolved</span>
            </Show>
            <Show when={props.canWrite}>
              <button
                type="button"
                onClick={() =>
                  patchThread.mutate({
                    parent: props.data.parent,
                    rootId: props.data.id,
                    patch: { resolved: !props.data.state.resolved },
                  })
                }
              >
                {props.data.state.resolved ? 'Reopen' : 'Resolve'}
              </button>
            </Show>
            <Show
              when={
                props.canWrite &&
                (props.canManage || props.data.state.user_id === userId())
              }
            >
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      'Delete this discussion and all its replies?'
                    )
                  )
                    deleteThread.mutate({
                      parent: props.data.parent,
                      rootId: props.data.id,
                    });
                }}
              >
                Delete discussion
              </button>
            </Show>
          </div>
        </Show>
        <ChannelThread
          data={() => props.data}
          parent={() => props.data.parent}
          getMessageActions={(message) => {
            const value = actions(message);
            return props.hideReplyInput
              ? { ...value, onReply: undefined }
              : value;
          }}
          messageEditor={editor}
          isExpanded={() => expanded() || !!props.targetId}
          setIsExpanded={setExpanded}
          isReplying={replying}
          setIsReplying={setReplying}
          replyInputState={draft}
          setReplyInputState={setDraft}
          replyInputHandle={handle}
          setReplyInputHandle={setHandle}
          replyInputFocusRequest={focus}
          isFindBarOpen={() => false}
          messageListScopeId={scopeId}
          selectedMessageId={() => (props.targetId ? props.data.id : undefined)}
          targetNavigation={{
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
            onClearTarget: () => {},
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

/** Reference discovery selects roots; live data and lazy replies remain in the common caches. */
export function MessageThreadFromSource(
  props: ThreadOptions & { parent: MessageParent; rootId: string }
) {
  useMessageSubscription(() => props.parent);
  const query = useMessageTimelineByIdsQuery(
    () => props.parent,
    () => [props.rootId]
  );
  return (
    <Show when={query.isSuccess && query.data[0]}>
      {(data) => <MessageThread {...props} data={data()} />}
    </Show>
  );
}
