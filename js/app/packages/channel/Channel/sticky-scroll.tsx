import { createEffect, on, type Accessor } from 'solid-js';
import type { ApiChannelMessage } from '@service-comms/client';

function isNearTrueBottom(
  isNearBottom: boolean,
  hasMoreBelow: boolean
): boolean {
  return isNearBottom && !hasMoreBelow;
}

function didInsertMessageOnBottom(
  currentMessages: Array<ApiChannelMessage>,
  previousMessages: Array<ApiChannelMessage> | undefined
): boolean {
  if (!previousMessages) return false;
  const lastCurrentMessage = currentMessages.at(-1);
  const lastPreviousMessage = previousMessages.at(-1);
  if (!lastCurrentMessage || !lastPreviousMessage) return false;
  return lastCurrentMessage.id !== lastPreviousMessage.id;
}

export type StickyScrollerProps = {
  isNearBottom: Accessor<boolean>;
  hasMoreBelow: Accessor<boolean>;
  messages: Accessor<Array<ApiChannelMessage>>;
  scrollToBottom: () => void;
};

export function createStickyScrollEffect(props: StickyScrollerProps) {
  createEffect(
    on(
      props.messages,
      (currentMessages, previousMessage) => {
        if (
          didInsertMessageOnBottom(currentMessages, previousMessage) &&
          isNearTrueBottom(props.isNearBottom(), props.hasMoreBelow())
        ) {
          props.scrollToBottom();
        }
      },
      {
        defer: true,
      }
    )
  );
}
