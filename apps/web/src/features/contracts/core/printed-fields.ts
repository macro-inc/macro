import type {
  AdoptedSignature,
  FieldBox,
  Packet,
  PacketField,
  Recipient,
} from './packet';
import { findRecipient } from './packet';

/** What a field prints on its page once its signer has signed. */
type FieldPrint =
  | { t: 'mark'; mark: AdoptedSignature }
  | { t: 'text'; text: string }
  | { t: 'check' };

export type PrintedField = { id: string; box: FieldBox; print: FieldPrint };

/** What one field prints for its recipient, or nothing before they sign. */
export function fieldPrint(
  field: PacketField,
  recipient: Recipient,
  formatDate: (iso: string) => string
): FieldPrint | undefined {
  if (!recipient.signedAt) return undefined;

  if (field.kind === 'signature') {
    return recipient.signature && { t: 'mark', mark: recipient.signature };
  }
  if (field.kind === 'initials') {
    return recipient.initials && { t: 'mark', mark: recipient.initials };
  }
  if (field.kind === 'checkbox') {
    return field.value === true ? { t: 'check' } : undefined;
  }
  if (field.kind === 'date_signed') {
    return { t: 'text', text: formatDate(recipient.signedAt) };
  }
  if (field.kind === 'full_name') return { t: 'text', text: recipient.name };
  if (field.kind === 'email') return { t: 'text', text: recipient.email };
  return typeof field.value === 'string' && field.value !== ''
    ? { t: 'text', text: field.value }
    : undefined;
}

/**
 * Everything signed so far that prints on one page of one document: marks,
 * entered text, ticks, and the values filled in at signing. A field whose
 * signer has not signed prints nothing.
 */
export function printedFields(
  packet: Pick<Packet, 'fields' | 'recipients'>,
  documentId: string,
  page: number,
  formatDate: (iso: string) => string
): PrintedField[] {
  return packet.fields.flatMap((field) => {
    if (field.documentId !== documentId || field.page !== page) return [];
    const recipient = findRecipient(packet, field.recipientId);
    const print = recipient && fieldPrint(field, recipient, formatDate);
    return print ? [{ id: field.id, box: field.box, print }] : [];
  });
}
