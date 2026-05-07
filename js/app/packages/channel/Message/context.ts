import { type Accessor, createContext, useContext } from 'solid-js';
import type { MessageActions, MessageData } from './types';

const MessageContext = createContext<Accessor<MessageData>>();
const MessageActionsContext = createContext<MessageActions>();

export const MessageProvider = MessageContext.Provider;
export const MessageActionsProvider = MessageActionsContext.Provider;

export function useMessage(): Accessor<MessageData> {
  const ctx = useContext(MessageContext);
  if (!ctx) throw new Error('useMessage must be used within <Msg.Root>');
  return ctx;
}

export function useMessageActions(): MessageActions | undefined {
  return useContext(MessageActionsContext);
}

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

export type MessageSelectionState = {
  isSelected: boolean;
};

const MessageSelectionContext = createContext<MessageSelectionState>();
export const MessageSelectionProvider = MessageSelectionContext.Provider;

export function useMessageSelection(): MessageSelectionState | undefined {
  return useContext(MessageSelectionContext);
}
