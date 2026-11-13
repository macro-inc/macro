import { createStore } from 'solid-js/store';
import type { Viewer } from '../context/contracts-context';
import type { DraftInput } from '../core/lifecycle';
import {
  DEFAULT_EXPIRATION_DAYS,
  DEFAULT_REMINDER_DAYS,
  type PacketDocument,
  type RecipientRole,
  type SigningOrder,
} from '../core/packet';

export type DraftRecipient = {
  id: string;
  name: string;
  email: string;
  role: RecipientRole;
};

export type DraftProblem =
  | 'title'
  | 'documents'
  | 'signers'
  | 'recipient_details'
  | 'database';

type DraftState = {
  title: string;
  documents: PacketDocument[];
  recipients: DraftRecipient[];
  /** The sender signs too, after everyone else. */
  includeSelf: boolean;
  signingOrder: SigningOrder;
  databaseIds: string[];
  company: string;
  expirationDays: number;
  reminderDays: number | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The New packet form. It owns what the sender has entered and says what is
 * still missing; nothing is created until `toInput` is handed to the host.
 */
export function createPacketDraft(options: {
  databaseId: string;
  newId: () => string;
}) {
  const [state, setState] = createStore<DraftState>({
    title: '',
    documents: [],
    recipients: [{ id: options.newId(), name: '', email: '', role: 'signer' }],
    includeSelf: true,
    signingOrder: 'sequential',
    databaseIds: [options.databaseId],
    company: '',
    expirationDays: DEFAULT_EXPIRATION_DAYS,
    reminderDays: DEFAULT_REMINDER_DAYS,
  });

  const filled = () =>
    state.recipients.filter(
      (recipient) => recipient.name.trim() || recipient.email.trim()
    );

  /** The first thing that stops the draft from moving on, if any. */
  const problem = (): DraftProblem | undefined => {
    if (!state.title.trim()) return 'title';
    if (state.documents.length === 0) return 'documents';
    if (state.databaseIds.length === 0) return 'database';

    const incomplete = filled().some(
      (recipient) =>
        !recipient.name.trim() || !EMAIL.test(recipient.email.trim())
    );
    if (incomplete) return 'recipient_details';

    const signerCount =
      filled().filter((recipient) => recipient.role === 'signer').length +
      (state.includeSelf ? 1 : 0);
    return signerCount === 0 ? 'signers' : undefined;
  };

  return {
    state,
    problem,

    setTitle: (title: string) => setState('title', title),
    setCompany: (company: string) => setState('company', company),
    setIncludeSelf: (include: boolean) => setState('includeSelf', include),
    setSigningOrder: (order: SigningOrder) => setState('signingOrder', order),
    setExpirationDays: (days: number) => setState('expirationDays', days),
    setReminderDays: (days: number | null) => setState('reminderDays', days),

    addDocument(document: PacketDocument) {
      setState('documents', (documents) => [...documents, document]);
      // The first document names an untitled packet.
      if (!state.title.trim()) setState('title', document.name);
    },
    removeDocument: (documentId: string) =>
      setState('documents', (documents) =>
        documents.filter((document) => document.id !== documentId)
      ),

    addRecipient: () =>
      setState('recipients', (recipients) => [
        ...recipients,
        { id: options.newId(), name: '', email: '', role: 'signer' },
      ]),
    updateRecipient: (id: string, patch: Partial<Omit<DraftRecipient, 'id'>>) =>
      setState('recipients', (recipient) => recipient.id === id, patch),
    removeRecipient: (id: string) =>
      setState('recipients', (recipients) =>
        recipients.filter((recipient) => recipient.id !== id)
      ),

    toggleDatabase(databaseId: string) {
      const selected = state.databaseIds.includes(databaseId);
      setState(
        'databaseIds',
        selected
          ? state.databaseIds.filter((id) => id !== databaseId)
          : [...state.databaseIds, databaseId]
      );
    },

    /** The draft as the host creates it. The sender countersigns last. */
    toInput(viewer: Viewer): DraftInput {
      const others = filled().map((recipient) => ({
        id: recipient.id,
        name: recipient.name.trim(),
        email: recipient.email.trim(),
        role: recipient.role,
        isSender: false,
      }));
      const sender = {
        id: options.newId(),
        name: viewer.name,
        email: viewer.email,
        role: 'signer' as const,
        isSender: true,
      };
      const signing = others.filter((recipient) => recipient.role === 'signer');
      const copies = others.filter((recipient) => recipient.role === 'copy');

      return {
        title: state.title.trim(),
        owner: { id: viewer.id, name: viewer.name },
        documents: [...state.documents],
        recipients: [
          ...signing,
          ...(state.includeSelf ? [sender] : []),
          ...copies,
        ],
        signingOrder: state.signingOrder,
        databaseIds: [...state.databaseIds],
        company: state.company.trim() || undefined,
        expirationDays: state.expirationDays,
        reminderDays: state.reminderDays,
      };
    },
  };
}
