import type { Result } from 'neverthrow';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { SourceRead } from '../../whatsapp-linked/context/whatsapp-linked-context';
import type {
  GroupDetail,
  GroupMessage,
  GroupSend,
  SendFailure,
  SendProgress,
} from '../core/group';

/** One mounted group's independent data and writes. */
export type WhatsAppGroupCapabilities = {
  group: SourceRead<GroupDetail>;
  /** Messages DSS stored, oldest first. */
  timeline: SourceRead<GroupMessage[]>;
  hasOlder: Accessor<boolean>;
  loadingOlder: Accessor<boolean>;
  /** Loads the next older page; false when that request failed. */
  loadOlder: () => Promise<boolean>;
  /** Records one write; DSS dedupes a retry that reuses its key. */
  send: (
    request: GroupSend,
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
const Context = createContext<WhatsAppGroupCapabilities>();
export function WhatsAppGroupProvider(
  props: ParentProps<{ value: WhatsAppGroupCapabilities }>
) {
  return (
    <Context.Provider value={props.value}>{props.children}</Context.Provider>
  );
}
export function useWhatsAppGroup() {
  const value = useContext(Context);
  if (!value) throw new Error('WhatsAppGroupProvider is required');
  return value;
}
