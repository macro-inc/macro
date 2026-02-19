import { createContext, useContext } from 'solid-js';
import type { MessageData } from './types';

const MessageContext = createContext<MessageData>();

export const MessageProvider = MessageContext.Provider;

export function useMessage(): MessageData {
  const ctx = useContext(MessageContext);
  if (!ctx) throw new Error('useMessage must be used within <Msg.Root>');
  return ctx;
}
