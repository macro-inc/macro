import type { Result } from 'neverthrow';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { SourceRead } from '../../whatsapp-linked/context/whatsapp-linked-context';
import type {
  ChatDetail,
  ChatMessage,
  ChatSend,
  SendFailure,
  SendProgress,
} from '../core/chat';

/** One mounted chat's independent data and writes. */
export type ExternalChatCapabilities = {
  chat: SourceRead<ChatDetail>;
  /** Messages DSS stored, oldest first. */
  timeline: SourceRead<ChatMessage[]>;
  hasOlder: Accessor<boolean>;
  loadingOlder: Accessor<boolean>;
  /** Loads the next older page; false when that request failed. */
  loadOlder: () => Promise<boolean>;
  /** Records one write; DSS dedupes a retry that reuses its key. */
  send: (
    request: ChatSend,
    idempotencyKey: string
  ) => Promise<Result<SendProgress, SendFailure>>;
  /** Progress of the recorded sends the page is waiting on. */
  delivery: (sendIds: Accessor<string[]>) => SourceRead<SendProgress[]>;
  upload: (
    file: File
  ) => Promise<Result<{ uploadId: string; audio: boolean }, SendFailure>>;
  /** A stored file's URL, resolved like Chat's static media. */
  fileUrl: (fileId: string) => string;
  markRead: (messageId: string) => Promise<unknown>;
  stopSync: () => Promise<unknown>;
};
const Context = createContext<ExternalChatCapabilities>();
export function ExternalChatContextProvider(
  props: ParentProps<{ value: ExternalChatCapabilities }>
) {
  return (
    <Context.Provider value={props.value}>{props.children}</Context.Provider>
  );
}
export function useExternalChat() {
  const value = useContext(Context);
  if (!value) throw new Error('ExternalChatContextProvider is required');
  return value;
}
