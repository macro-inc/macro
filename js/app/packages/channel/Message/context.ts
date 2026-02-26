import { createContext, useContext } from 'solid-js';
import type { MessageActions, MessageData } from './types';

const MessageContext = createContext<MessageData>();
const MessageActionsContext = createContext<MessageActions>();

export const MessageProvider = MessageContext.Provider;
export const MessageActionsProvider = MessageActionsContext.Provider;

export function useMessage(): MessageData {
  const ctx = useContext(MessageContext);
  if (!ctx) throw new Error('useMessage must be used within <Msg.Root>');
  return ctx;
}

export function useMessageActions(): MessageActions | undefined {
  return useContext(MessageActionsContext);
}
