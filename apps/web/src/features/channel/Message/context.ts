import { type Accessor, createContext, useContext } from 'solid-js';
import type { MessageActions, MessageData } from './types';

const MessageContext = createContext<Accessor<MessageData>>();
const MessageActionsContext = createContext<MessageActions>();

type MessageActionMenuVisibility = {
  visible: Accessor<boolean>;
  setPersistent: (persistent: boolean) => void;
};

const MessageActionMenuVisibilityContext =
  createContext<MessageActionMenuVisibility>();

export type SearchHighlightTermsLookup = (
  messageId: string
) => readonly string[] | undefined;

const SearchHighlightTermsContext = createContext<SearchHighlightTermsLookup>();

export const MessageProvider = MessageContext.Provider;
export const MessageActionsProvider = MessageActionsContext.Provider;
export const MessageActionMenuVisibilityProvider =
  MessageActionMenuVisibilityContext.Provider;
export const SearchHighlightTermsProvider =
  SearchHighlightTermsContext.Provider;

export function useSearchHighlightTermsLookup():
  | SearchHighlightTermsLookup
  | undefined {
  return useContext(SearchHighlightTermsContext);
}

export function useMessage(): Accessor<MessageData> {
  const ctx = useContext(MessageContext);
  if (!ctx) throw new Error('useMessage must be used within <Msg.Root>');
  return ctx;
}

export function useMessageActions(): MessageActions | undefined {
  return useContext(MessageActionsContext);
}

export function useMessageActionMenuVisibility(): MessageActionMenuVisibility {
  const ctx = useContext(MessageActionMenuVisibilityContext);
  if (!ctx) {
    throw new Error(
      'useMessageActionMenuVisibility must be used within <Message.Root>'
    );
  }
  return ctx;
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
