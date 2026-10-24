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
  PendingSend,
} from '../core/group';

/** One mounted group's independent data and writes. */
export type WhatsAppGroupCapabilities = {
  group: SourceRead<GroupDetail>;
  timeline: SourceRead<GroupMessage[]>;
  sends: SourceRead<PendingSend[]>;
  hasOlder: Accessor<boolean>;
  loadingOlder: Accessor<boolean>;
  loadOlder: () => Promise<unknown>;
  send: (request: GroupSend, idempotencyKey: string) => Promise<unknown>;
  upload: (file: File) => Promise<{ uploadId: string; audio: boolean }>;
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
