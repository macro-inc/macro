import { createContext, useContext, type Accessor } from 'solid-js';
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
