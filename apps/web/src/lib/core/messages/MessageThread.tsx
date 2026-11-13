import { createChannelMessageActions } from '@channel/Channel/create-channel-message-actions';
import { createDeleteMessageConfirmation } from '@channel/Channel/create-delete-message-confirmation';
import { createMessageEditor } from '@channel/Channel/create-message-editor';
import type { InputHandle, InputSnapshot } from '@channel/Input';
import { MaybeMessageActionDrawerManager } from '@channel/Mobile/MessageActionDrawerManager';
import { ChannelThread } from '@channel/Thread/ChannelThread';
import { createFocusRequest } from '@channel/Thread/focus-request';
import { buildMessageLink } from '@channel/Thread/utils/message-actions';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
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
  Message,
  MessageListItem,
  MessageParent,
  MessageThread as ThreadData,
} from '@service-storage/messages';
import { createEffect, createSignal, Show } from 'solid-js';
import { MessageLoadError } from './MessageLoadError';
import {
  useMessageTransport,
  useMessageViewerOverride,
} from './message-transport';
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

async function reportGuestMutation(
  work: Promise<void>,
  failure: string
): Promise<void> {
  try {
    await work;
  } catch (error) {
    toast.failure(failure);
    throw error;
  }
}

type ThreadOptions = {
  canWrite: boolean;
  /** Complete replies from an already loaded thread. */
  replies?: Message[];
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
  /** Reply through a composer owned by the enclosing surface. */
  onReply?: MessageActionHandler;
  hideRail?: boolean;
  onEditingChange?: (id: string, editing: boolean) => void;
  monorail?: boolean;
  /**
   * Document comment bubble is the focused surface: Enter opens a reply
   * (same as chat on a selected message) and the thread accepts keyboard focus.
   */
  keyboardActive?: boolean;
};

/** Document and source-channel threads compose the existing channel thread and message controls. */
export function MessageThread(
  props: ThreadOptions & { data: MessageListItem }
) {
  const accountUserId = useUserId();
  const userId = useMessageViewerOverride() ?? accountUserId;
  const transport = useMessageTransport();
  const [expanded, setExpanded] = createSignal(props.expanded ?? false);
  const [replying, setReplying] = createSignal(false);
  const [draft, setDraft] = createSignal<InputSnapshot>();
  const [handle, setHandle] = createSignal<InputHandle>();
  const [attachScope, scopeId] = useHotkeyDOMScope('message-thread');
  let scopeElement: HTMLDivElement | undefined;
  const focus = createFocusRequest();
  const remove = useDeleteMessageMutation();
  const confirm = createDeleteMessageConfirmation((input) => {
    if (transport) {
      fireAndForget(
        reportGuestMutation(
          transport.remove({ parent: input.parent, id: input.messageID }),
          'Failed to delete message'
        ),
        'message-thread'
      );
      return;
    }
    remove.mutate(input);
  });
  const patch = usePatchMessageMutation();
  const addReaction = useAddReactionMutation();
  const removeReaction = useRemoveReactionMutation();
  const editor = createMessageEditor({
    parent: () => props.data.parent,
    patchMessage: (input) => {
      if (transport) {
        fireAndForget(
          reportGuestMutation(
            transport.patch({
              parent: input.parent,
              id: input.messageID,
              content: input.content,
            }),
            'Failed to update message'
          ),
          'message-thread'
        );
        return;
      }
      patch.mutate(input);
    },
    onEditEnded: (message) => props.onEditingChange?.(message.id, false),
  });
  const startReply = () => {
    if (props.onReply) {
      fireAndForget(
        Promise.resolve(props.onReply({ message: props.data })),
        'message-thread'
      );
      return;
    }
    setExpanded(true);
    setReplying(true);
    focus.request();
  };
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
    addReaction: (input) => {
      if (transport) {
        fireAndForget(
          reportGuestMutation(
            transport.react({
              parent: input.parent,
              id: input.messageId,
              emoji: input.emoji,
              add: true,
            }),
            'Failed to add reaction'
          ),
          'message-thread'
        );
        return;
      }
      addReaction.mutate(input);
    },
    removeReaction: (input) => {
      if (transport) {
        fireAndForget(
          reportGuestMutation(
            transport.react({
              parent: input.parent,
              id: input.messageId,
              emoji: input.emoji,
              add: false,
            }),
            'Failed to remove reaction'
          ),
          'message-thread'
        );
        return;
      }
      removeReaction.mutate(input);
    },
    onEdit: ({ message }) => {
      editor.start(message);
      props.onEditingChange?.(message.id, true);
    },
    onReply: (context) => {
      if (props.onReply) return props.onReply(context);
      setExpanded(true);
      setReplying(true);
      focus.request();
    },
  });
  // Comment bubbles are not channel-selected messages; take Enter here instead.
  registerHotkey({
    scopeId,
    hotkey: 'enter',
    description: 'Reply to comment',
    condition: () =>
      !!props.keyboardActive &&
      props.canWrite &&
      !props.hideReplyInput &&
      !replying() &&
      !editor.state(),
    keyDownHandler: (event) => {
      if (event?.repeat) return true;
      startReply();
      return true;
    },
  });
  // Keep the bubble in the hotkey DOM scope while it is the active comment.
  createEffect(() => {
    if (!props.keyboardActive) return;
    if (replying() || editor.state()) return;
    const el = scopeElement;
    if (!el) return;
    if (el.contains(document.activeElement)) return;
    el.focus({ preventScroll: true });
  });
  return (
    <MaybeMessageActionDrawerManager>
      <div
        ref={(el) => {
          scopeElement = el;
          attachScope(el);
        }}
        data-message-thread={props.data.id}
        tabindex={props.keyboardActive ? -1 : undefined}
        class="relative isolate outline-none"
      >
        <confirm.ConfirmationDialog />
        <ChannelThread
          data={() => props.data}
          replies={props.replies ? () => props.replies ?? [] : undefined}
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
            props.canWrite && !props.hideReplyInput && replying()
          }
          setIsReplying={setReplying}
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
  const missing = () => thrownResultErrorHasCode(query.error, 'NOT_FOUND');
  return (
    <Show
      when={query.isSuccess && !query.data.state.deleted_at}
      fallback={
        <Show when={query.isError}>
          <MessageLoadError
            retrying={query.isFetching}
            onRetry={
              missing()
                ? undefined
                : () => fireAndForget(query.refetch(), 'message-thread')
            }
          >
            {missing()
              ? 'This thread is unavailable.'
              : 'Could not load thread.'}
          </MessageLoadError>
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
