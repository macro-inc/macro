/** Packet lifecycle states. The system derives them; see `packetStatus`. */
const PACKET_STATUSES = [
  'draft',
  'sent',
  'partially_signed',
  'signed',
  'declined',
  'voided',
  'expired',
] as const;
export type PacketStatus = (typeof PACKET_STATUSES)[number];

/** Parallel invites every signer at once; sequential invites them in list order. */
export type SigningOrder = 'parallel' | 'sequential';

/** A signer completes fields; a copy recipient only receives the result. */
export type RecipientRole = 'signer' | 'copy';

export const FIELD_KINDS = [
  'signature',
  'initials',
  'date_signed',
  'full_name',
  'email',
  'text',
  'checkbox',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const SIGNATURE_STYLES = ['script-1', 'script-2', 'script-3'] as const;
export type SignatureStyle = (typeof SIGNATURE_STYLES)[number];

/** How a recipient chose to render their signature or initials. */
export type AdoptedSignature =
  | { kind: 'typed'; text: string; style: SignatureStyle }
  | { kind: 'drawn'; dataUrl: string }
  | { kind: 'image'; dataUrl: string };

export type PacketDocument = {
  id: string;
  name: string;
  pageCount: number;
  source: 'drive' | 'upload';
  /** Set when the PDF was produced from another format before placement. */
  convertedFrom?: 'docx';
  /** SHA-256 of the PDF bytes placed and signed. */
  sha256: string;
};

/** An active signing link. A recipient without one cannot open the packet. */
export type RecipientAccess = {
  token: string;
  tokenId: string;
  issuedAt: string;
};

export type Recipient = {
  id: string;
  name: string;
  email: string;
  role: RecipientRole;
  /** The sender signing their own packet, such as a countersigner. */
  isSender: boolean;
  access?: RecipientAccess;
  viewedAt?: string;
  disclosureAcceptedAt?: string;
  signedAt?: string;
  declinedAt?: string;
  declineReason?: string;
  signature?: AdoptedSignature;
  initials?: AdoptedSignature;
  userAgent?: string;
};

/** A field's box as fractions of its page, matching PDF placeables. */
export type FieldBox = {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
};

export type PacketField = {
  id: string;
  documentId: string;
  /** Zero-based page index within the document. */
  page: number;
  recipientId: string;
  kind: FieldKind;
  required: boolean;
  box: FieldBox;
  /**
   * Text for text-like fields and `true`/`false` for a checkbox. Signature
   * and initials fields render the recipient's adopted mark instead.
   */
  value?: string | boolean;
};

/** Typed lifecycle events that routines consume, plus audit-only entries. */
export type PacketEventType =
  | 'contract.created'
  | 'contract.sent'
  | 'contract.viewed'
  | 'contract.signed_by_recipient'
  | 'contract.completed'
  | 'contract.declined'
  | 'contract.voided'
  | 'contract.expired'
  | 'audit.disclosure_accepted'
  | 'audit.reminder_sent'
  | 'audit.documents_replaced'
  | 'audit.packets_merged'
  | 'audit.status_overridden';

export type PacketEvent = {
  id: string;
  type: PacketEventType;
  at: string;
  /** Display name of the person or system that caused the event. */
  actor: string;
  recipientId?: string;
  note?: string;
  /** Digest of the documents and field values after this event. */
  stateHash?: string;
  /** Chained digest of this event and the one before it. Set when sealed. */
  hash?: string;
};

/** An authorized manual status, recorded with an audit tag. */
type StatusOverride = {
  status: 'signed';
  tag: 'offline';
  by: string;
  at: string;
};

export type PacketOwner = { id: string; name: string };

/** A packet that was merged into another, with the log it had, kept whole. */
export type MergedPacket = {
  id: string;
  title: string;
  mergedAt: string;
  events: PacketEvent[];
};

export type Packet = {
  id: string;
  title: string;
  owner: PacketOwner;
  documents: PacketDocument[];
  /** Signers sign in this order when `signingOrder` is sequential. */
  recipients: Recipient[];
  fields: PacketField[];
  signingOrder: SigningOrder;
  /** Every packet lives in at least one Contracts database. */
  databaseIds: string[];
  company?: string;
  expirationDays: number;
  /** Days between reminders to pending signers, or `null` for none. */
  reminderDays: number | null;
  createdAt: string;
  sentAt?: string;
  expiresAt?: string;
  completedAt?: string;
  expiredAt?: string;
  voidedAt?: string;
  voidReason?: string;
  lastReminderAt?: string;
  statusOverride?: StatusOverride;
  events: PacketEvent[];
  /** Packets merged into this one, oldest first. */
  merged?: MergedPacket[];
};

export const DEFAULT_EXPIRATION_DAYS = 30;
export const DEFAULT_REMINDER_DAYS = 3;

export function signers(packet: Pick<Packet, 'recipients'>): Recipient[] {
  return packet.recipients.filter((recipient) => recipient.role === 'signer');
}

export function findRecipient(
  packet: Pick<Packet, 'recipients'>,
  recipientId: string
): Recipient | undefined {
  return packet.recipients.find((recipient) => recipient.id === recipientId);
}

/** The recipient holding this signing token, if the link is still active. */
export function recipientForToken(
  packet: Pick<Packet, 'recipients'>,
  token: string
): Recipient | undefined {
  return packet.recipients.find(
    (recipient) => recipient.access?.token === token
  );
}
