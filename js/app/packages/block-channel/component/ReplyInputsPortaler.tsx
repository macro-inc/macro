import { useMessageListContext } from '@block-channel/component/MessageList/MessageList';
import {
  channelStore,
  type SendMessageArgs,
  useSendChannelMessageAction,
} from '@block-channel/signal/channel';
import type { ThreadStoreData } from '@block-channel/signal/threads';
import { postTypingUpdate } from '@block-channel/signal/typing';
import {
  clearDraftMessage,
  loadDraftMessage,
  saveDraftMessage,
} from '@block-channel/utils/draftMessages';
import { blockElementSignal } from '@core/signal/blockElement';
import type { InputAttachment } from '@core/store/cacheChannelInput';
import { channelParticipantInfo } from '@core/user/util';
import { createCallback } from '@solid-primitives/rootless';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type Setter,
} from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { BaseInput } from './BaseInput';

export type ReplyInputsPortalerProps = {
  channelId: string;
  threads: ThreadStoreData;
  threadInputAttachmentsStore: Record<string, InputAttachment[]>;
  setThreadInputAttachmentsStore: SetStoreFunction<
    Record<string, InputAttachment[]>
  >;
  setLocalTypingThreadId?: Setter<string | undefined>;
};

export function ReplyInputsPortaler(props: ReplyInputsPortalerProps) {
  const listContext = useMessageListContext();
  const sendMessage = useSendChannelMessageAction(() => props.channelId);

  const postTypingUpdate_ = createCallback(postTypingUpdate);
  const blockRef = blockElementSignal.get;

  const channel = channelStore.get;
  const channelUsers = createMemo(() => {
    const participants = channel.participants ?? [];
    return participants.map(channelParticipantInfo);
  });

  const [focusedReplyInputThreadId, setFocusedReplyInputThreadId] =
    createSignal<string>();

  const onSend = (threadId: string) => async (args: SendMessageArgs) => {
    clearDraftMessage(props.channelId, threadId);
    await sendMessage({ ...args, threadId });
    // After sending, focus the message immediately after the current one in the
    // flattened list.
    // Use a timeout to ensure the new message mounts in the DOM first.
    setTimeout(() => {
      const list = listContext.orderedMessages() ?? [];
      const lastMessageInThreadId = props.threads[threadId]?.at(-1)?.id;
      const currentIdx = list.findIndex((m) => m.id === lastMessageInThreadId);
      const targetIndex = currentIdx >= 0 ? currentIdx + 1 : -1;
      if (targetIndex < 0 || targetIndex >= list.length) return;
      const targetMessageId = list[targetIndex]?.id;
      if (!targetMessageId) return;

      // Ensure it's scrolled into view in the virtual list
      listContext.scrollToIndex(targetIndex, { align: 'nearest' });

      // Then focus the element once mounted
      setTimeout(() => {
        const el = document.querySelector(
          `[data-message-body-id="${targetMessageId}"]`
        ) as HTMLElement | null;
        el?.focus();
      }, 0);
    }, 100);
  };

  const onAfterSend = (threadId: string) => () => {
    listContext.clearThreadFocus(threadId, true);
  };

  const onEmptyBlur = (threadId: string) => () => {
    clearDraftMessage(props.channelId, threadId);
    listContext.clearThreadFocus(threadId, true);
  };

  const onFocusLeaveStart = (e: KeyboardEvent, threadId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const orderedMessages = listContext
      .orderedMessages()
      .filter((item) => item.thread_id === threadId);
    if (!orderedMessages.length) return;
    const lastMessageId = orderedMessages[orderedMessages.length - 1].id;
    const lastMessageBody = blockRef()?.querySelector(
      `[data-message-body-id="${lastMessageId}"]`
    );
    if (!lastMessageBody) return;
    (lastMessageBody as HTMLElement).focus();
  };

  let replyFocusTimeout: ReturnType<typeof setTimeout> | undefined;

  return (
    <For each={listContext.getThreadsWithActiveReplies()}>
      {(threadId) => {
        const threadState = createMemo(() =>
          listContext.getThreadState(threadId)
        );
        // This create effect maintains focus on reply inputs when the mount target changes due to new messages in the thread coming in
        // TODO: this should only fire if this reply input was focused
        createEffect((prev) => {
          const state = threadState();
          if (
            focusedReplyInputThreadId() === threadId &&
            state?.replyInputMountTarget &&
            prev &&
            prev !== state?.replyInputMountTarget
          ) {
            listContext.toggleReplyInputFocus(threadId, true);
          }
          return state?.replyInputMountTarget;
        });
        return (
          <Portal mount={threadState()?.replyInputMountTarget ?? document.body}>
            <div
              classList={{
                'fixed top-0 left-0 width-[1px] height-[1px] overflow-hidden opacity-0 pointer-events-none':
                  !threadState()?.replyInputMountTarget,
              }}
            >
              <BaseInput
                onSend={onSend(threadId)}
                afterSend={onAfterSend(threadId)}
                placeholder={`Send a reply`}
                autoFocusOnMount={false}
                shouldFocus={threadState()?.replyInputShouldFocus}
                clearShouldFocus={() =>
                  listContext.toggleReplyInputFocus(threadId, false)
                }
                onFocus={() => {
                  if (replyFocusTimeout) clearTimeout(replyFocusTimeout);
                  setFocusedReplyInputThreadId(threadId);
                }}
                onBlur={() => {
                  replyFocusTimeout = setTimeout(() => {
                    setFocusedReplyInputThreadId(undefined);
                  }, 100);
                }}
                onStartTyping={() => postTypingUpdate_('start', threadId)}
                onStopTyping={() => postTypingUpdate_('stop', threadId)}
                inputAttachments={{
                  store: props.threadInputAttachmentsStore,
                  setStore: props.setThreadInputAttachmentsStore,
                  key: threadId,
                }}
                channelUsers={channelUsers}
                setLocalTyping={
                  props.setLocalTypingThreadId
                    ? (isTyping) =>
                        props.setLocalTypingThreadId?.(
                          isTyping ? threadId : undefined
                        )
                    : undefined
                }
                onChange={(content) =>
                  saveDraftMessage(props.channelId, {
                    content,
                    attachments:
                      props.threadInputAttachmentsStore[threadId] ?? [],
                    threadId,
                  })
                }
                initialValue={() =>
                  loadDraftMessage(props.channelId, threadId)?.content ?? ''
                }
                onFocusLeaveStart={(e) => {
                  onFocusLeaveStart(e, threadId);
                }}
                onEmptyBlur={onEmptyBlur(threadId)}
                isReplyInput
              />
            </div>
          </Portal>
        );
      }}
    </For>
  );
}
