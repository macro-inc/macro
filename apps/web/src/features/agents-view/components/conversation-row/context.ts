import { createContext, type JSX, useContext } from 'solid-js';
import type { ConversationState } from '../../core/conversation-state';
import type { AgentsMode } from '../../core/mode';

export type ConversationRowProps = {
  id: string;
  title: string;
  kind: AgentsMode;
  state: ConversationState;
  active?: boolean;
  unread?: boolean;
  failed?: boolean;
  waiting?: boolean;
  untitled?: boolean;
  onOpen?: (event: MouseEvent) => void;
  children: JSX.Element;
};

export const ConversationRowContext = createContext<{
  row: ConversationRowProps;
  setTitleElement: (element: HTMLSpanElement) => void;
}>();

export function useConversationRow() {
  const context = useContext(ConversationRowContext);
  if (!context) throw new Error('ConversationRowRoot is required');
  return context.row;
}

export function useConversationRowTitleRef() {
  const context = useContext(ConversationRowContext);
  if (!context) throw new Error('ConversationRowRoot is required');
  return context.setTitleElement;
}
