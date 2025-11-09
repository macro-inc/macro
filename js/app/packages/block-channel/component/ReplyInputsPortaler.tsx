import { sendMessage } from '@block-channel/signal/channel';
import type { ThreadStoreData } from '@block-channel/signal/threads';
import { postTypingUpdate } from '@block-channel/signal/typing';
import type { ThreadViewData } from '@block-channel/type/threadView';
import {
  clearDraftMessage,
  loadDraftMessage,
  saveDraftMessage,
} from '@block-channel/utils/draftMessages';
import { blockElementSignal } from '@core/signal/blockElement';
import type { InputAttachment } from '@core/store/cacheChannelInput';
import type { Message } from '@service-comms/generated/models';
import { createCallback } from '@solid-primitives/rootless';
import { type Accessor, createEffect, For } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import type { VirtualizerHandle } from 'virtua/solid';
import { BaseInput } from './BaseInput';

export type ReplyInputsPortalerProps = {
  channelId: string;
  orderedMessages: Accessor<Message[]>;
  threadViewStore: ThreadViewData;
  setThreadViewStore: SetStoreFunction<ThreadViewData>;
  threads: ThreadStoreData;
  virtualHandle: Accessor<VirtualizerHandle | undefined>;
  threadInputAttachmentsStore: Record<string, InputAttachment[]>;
  setThreadInputAttachmentsStore: SetStoreFunction<
    Record<string, InputAttachment[]>
  >;
  setLocalTyping?: (isTyping: boolean) => void;
};

export function ReplyInputsPortaler(props: ReplyInputsPortalerProps) {
  const postTypingUpdate_ = createCallback(postTypingUpdate);
  const sendMessage_ = createCallback(sendMessage);
  const blockRef = blockElementSignal.get;

  const onSend =
    (threadId: string) => async (args: Parameters<typeof sendMessage>[0]) => {
      clearDraftMessage(props.channelId, threadId);
      await sendMessage_({ ...args, threadId });
      // After sending, focus the message immediately after the current one in the
      // flattened list.
      // Use a timeout to ensure the new message mounts in the DOM first.
      setTimeout(() => {
        const list = props.orderedMessages() ?? [];
        const lastMessageInThreadId = props.threads[threadId]?.at(-1)?.id;
        const currentIdx = list.findIndex(
          (m) => m.id === lastMessageInThreadId
        );
        const targetIndex = currentIdx >= 0 ? currentIdx + 1 : -1;
        if (targetIndex < 0 || targetIndex >= list.length) return;
        const targetMessageId = list[targetIndex]?.id;
        if (!targetMessageId) return;

        // Ensure it's scrolled into view in the virtual list
        props.virtualHandle()?.scrollToIndex(targetIndex, { align: 'nearest' });

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
    props.setThreadViewStore(threadId, (prev) =>
      prev
        ? { ...prev, threadExpanded: true, hasActiveReply: false }
        : { threadExpanded: true, hasActiveReply: false }
    );
    props.setThreadViewStore(threadId, (prev) =>
      prev
        ? { ...prev, threadExpanded: true, hasActiveReply: false }
        : { threadExpanded: true, hasActiveReply: false }
    );
  };

  const onEsc = (threadId: string) => () => {
    props.setThreadViewStore(threadId, (prev) =>
      prev
        ? { ...prev, threadExpanded: true, hasActiveReply: false }
        : { threadExpanded: true, hasActiveReply: false }
    );
  };

  const onFocusLeaveStart = (e: KeyboardEvent, threadId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const orderedMessages = props
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

  return (
    <For
      each={Object.keys(props.threadViewStore).filter(
        (threadId) => props.threadViewStore[threadId].hasActiveReply
      )}
    >
      {(threadId) => {
        createEffect((prev) => {
          if (
            props.threadViewStore[threadId].replyInputMountTarget &&
            prev !== props.threadViewStore[threadId].replyInputMountTarget
          ) {
            props.setThreadViewStore(threadId, (prev) => ({
              ...prev,
              replyInputShouldFocus: true,
            }));
          }
          return props.threadViewStore[threadId].replyInputMountTarget;
        });
        return (
          <Portal
            mount={
              props.threadViewStore[threadId].replyInputMountTarget ??
              document.body
            }
          >
            <div
              classList={{
                'fixed top-0 left-0 width-[1px] height-[1px] overflow-hidden opacity-0 pointer-events-none':
                  !props.threadViewStore[threadId].replyInputMountTarget,
              }}
            >
              <BaseInput
                onSend={onSend(threadId)}
                afterSend={onAfterSend(threadId)}
                placeholder={`Send a reply`}
                autoFocusOnMount={false}
                shouldFocus={
                  props.threadViewStore[threadId].replyInputShouldFocus
                }
                clearShouldFocus={() =>
                  props.setThreadViewStore(threadId, (prev) => ({
                    ...prev,
                    replyInputShouldFocus: false,
                  }))
                }
                onStartTyping={() => postTypingUpdate_('start', threadId)}
                onStopTyping={() => postTypingUpdate_('stop', threadId)}
                inputAttachments={{
                  store: props.threadInputAttachmentsStore,
                  setStore: props.setThreadInputAttachmentsStore,
                  key: threadId,
                }}
                setLocalTyping={props.setLocalTyping}
                onChange={(content) =>
                  saveDraftMessage(props.channelId, {
                    content,
                    attachments:
                      props.threadInputAttachmentsStore[threadId] ?? [],
                    threadId,
                  })
                }
                onEmpty={() => clearDraftMessage(props.channelId, threadId)}
                escHandler={onEsc(threadId)}
                initialValue={() =>
                  loadDraftMessage(props.channelId, threadId)?.content ?? ''
                }
                onFocusLeaveStart={(e) => {
                  onFocusLeaveStart(e, threadId);
                }}
              />
            </div>
          </Portal>
        );
      }}
    </For>
  );
}
