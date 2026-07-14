import { type Accessor, createContext, useContext } from 'solid-js';
import type { MessageActions, MessageData } from '../Message/types';

export type MessageActionDrawerState = {
  isOpen: Accessor<boolean>;
  message: Accessor<MessageData | undefined>;
  actions: Accessor<MessageActions | undefined>;
  open: (message: MessageData, actions: MessageActions | undefined) => void;
  close: () => void;
};

const MessageActionDrawerContext = createContext<MessageActionDrawerState>();
export const MessageActionDrawerContextProvider =
  MessageActionDrawerContext.Provider;

export function useMessageActionDrawer(): MessageActionDrawerState | undefined {
  return useContext(MessageActionDrawerContext);
}
