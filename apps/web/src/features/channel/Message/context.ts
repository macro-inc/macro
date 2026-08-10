import type { FoldedMessageLookup } from '@queries/channel/folded-messages';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { MessageActions, MessageData } from './types';

const MessageContext = createContext<Accessor<MessageData>>();
const MessageActionsContext = createContext<MessageActions>();

export type SearchHighlightTermsLookup = (
  messageId: string
) => readonly string[] | undefined;

const SearchHighlightTermsContext = createContext<SearchHighlightTermsLookup>();

// An accessor, not a lookup: the fold resolves after the message tree has
// already been created (Suspense runs children while its resource is pending),
// so a context holding the value itself hands every consumer the `undefined`
// it had at creation and never updates them. Reading through an accessor puts
// the read in the consumer's own tracking scope, which is where it has to be
// for the messages to hydrate when the fold lands.
const FoldedMessagesContext =
  createContext<Accessor<FoldedMessageLookup | undefined>>();

export const MessageProvider = MessageContext.Provider;
export const MessageActionsProvider = MessageActionsContext.Provider;
export const SearchHighlightTermsProvider =
  SearchHighlightTermsContext.Provider;
export const FoldedMessagesProvider = FoldedMessagesContext.Provider;

export function useSearchHighlightTermsLookup():
  | SearchHighlightTermsLookup
  | undefined {
  return useContext(SearchHighlightTermsContext);
}

export function useFoldedMessageLookup():
  | Accessor<FoldedMessageLookup | undefined>
  | undefined {
  return useContext(FoldedMessagesContext);
}

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
