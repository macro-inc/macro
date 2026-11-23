import type { MessageActions, MessageData } from '@core/messages/types';
import type { MessageParent } from '@service-storage/messages';
import { type Accessor, createContext, useContext } from 'solid-js';

export type MessageActionDrawerState = {
  isOpen: Accessor<boolean>;
  message: Accessor<MessageData | undefined>;
  actions: Accessor<MessageActions | undefined>;
  /** The stored conversation of the message, when its row knows it. */
  parent: Accessor<MessageParent | undefined>;
  open: (
    message: MessageData,
    actions: MessageActions | undefined,
    parent?: MessageParent
  ) => void;
  close: () => void;
};

const MessageActionDrawerContext = createContext<MessageActionDrawerState>();
export const MessageActionDrawerContextProvider =
  MessageActionDrawerContext.Provider;

export function useMessageActionDrawer(): MessageActionDrawerState | undefined {
  return useContext(MessageActionDrawerContext);
}
