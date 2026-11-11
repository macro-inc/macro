import type { MessageParent } from '@service-storage/messages';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';

/**
 * How a message surface changes messages. Signed-in surfaces use the account
 * message API; a call's guest reaches the same thread through its guest
 * credential. Rendering never knows which.
 */
export type MessageTransport = {
  patch(input: {
    parent: MessageParent;
    id: string;
    content: string;
  }): Promise<void>;
  remove(input: { parent: MessageParent; id: string }): Promise<void>;
  react(input: {
    parent: MessageParent;
    id: string;
    emoji: string;
    add: boolean;
  }): Promise<void>;
};

const MessageTransportContext = createContext<MessageTransport>();

export function MessageTransportProvider(
  props: ParentProps<{ value: MessageTransport }>
) {
  return (
    <MessageTransportContext.Provider value={props.value}>
      {props.children}
    </MessageTransportContext.Provider>
  );
}

/** A provided transport, or undefined for the account message API. */
export function useMessageTransport(): MessageTransport | undefined {
  return useContext(MessageTransportContext);
}

const MessageViewerContext = createContext<Accessor<string | undefined>>();

/**
 * Who is reading, as the `sender_id` their own messages and reactions carry.
 * Defaults to the signed-in account; a call's guest provides its guest id.
 */
export function MessageViewerProvider(
  props: ParentProps<{ viewerId: Accessor<string | undefined> }>
) {
  return (
    <MessageViewerContext.Provider value={props.viewerId}>
      {props.children}
    </MessageViewerContext.Provider>
  );
}

/** The provided viewer, or undefined to fall back to the signed-in account. */
export function useMessageViewerOverride():
  | Accessor<string | undefined>
  | undefined {
  return useContext(MessageViewerContext);
}

const MessageSenderNameContext =
  createContext<(senderId: string) => string | undefined>();

export function MessageSenderNameProvider(
  props: ParentProps<{ resolve: (senderId: string) => string | undefined }>
) {
  return (
    <MessageSenderNameContext.Provider value={props.resolve}>
      {props.children}
    </MessageSenderNameContext.Provider>
  );
}

export function useMessageSenderName() {
  return useContext(MessageSenderNameContext);
}
