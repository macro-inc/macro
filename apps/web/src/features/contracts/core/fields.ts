import type {
  FieldBox,
  FieldKind,
  Packet,
  PacketField,
  Recipient,
} from './packet';
import { signers } from './packet';

/** Default field size as fractions of a US Letter page (612 x 792 pt). */
const DEFAULT_SIZES: Record<
  FieldKind,
  { widthPct: number; heightPct: number }
> = {
  signature: { widthPct: 0.3, heightPct: 0.055 },
  initials: { widthPct: 0.09, heightPct: 0.04 },
  date_signed: { widthPct: 0.18, heightPct: 0.03 },
  full_name: { widthPct: 0.28, heightPct: 0.03 },
  email: { widthPct: 0.28, heightPct: 0.03 },
  text: { widthPct: 0.28, heightPct: 0.03 },
  checkbox: { widthPct: 0.028, heightPct: 0.022 },
};

const MIN_FIELD_SIZE_PCT = 0.015;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keep a box inside its page and no smaller than a usable target. */
export function clampBox(box: FieldBox): FieldBox {
  const widthPct = clamp(box.widthPct, MIN_FIELD_SIZE_PCT, 1);
  const heightPct = clamp(box.heightPct, MIN_FIELD_SIZE_PCT, 1);
  return {
    widthPct,
    heightPct,
    xPct: clamp(box.xPct, 0, 1 - widthPct),
    yPct: clamp(box.yPct, 0, 1 - heightPct),
  };
}

/** A box of the kind's default size centered on a drop point. */
export function boxAtPoint(
  kind: FieldKind,
  point: { xPct: number; yPct: number }
): FieldBox {
  const size = DEFAULT_SIZES[kind];
  return clampBox({
    ...size,
    xPct: point.xPct - size.widthPct / 2,
    yPct: point.yPct - size.heightPct / 2,
  });
}

/** Fields the signer does not type: the system fills them at signing. */
export function isAutoFilled(kind: FieldKind): boolean {
  return kind === 'date_signed' || kind === 'full_name' || kind === 'email';
}

/** Fields rendered from the signer's adopted signature or initials. */
export function isMark(kind: FieldKind): boolean {
  return kind === 'signature' || kind === 'initials';
}

export function fieldsFor(
  packet: Pick<Packet, 'fields'>,
  recipientId: string
): PacketField[] {
  return packet.fields.filter((field) => field.recipientId === recipientId);
}

/**
 * Whether the signer has done their part for this field. Marks need an
 * adopted signature, a required checkbox must be ticked, and text needs
 * content. Auto-filled fields are always satisfied.
 */
function isFieldComplete(
  field: PacketField,
  recipient: Pick<Recipient, 'signature' | 'initials'>
): boolean {
  if (isAutoFilled(field.kind)) return true;
  if (field.kind === 'signature') return recipient.signature !== undefined;
  if (field.kind === 'initials') return recipient.initials !== undefined;
  if (field.kind === 'checkbox') return field.value === true;
  return typeof field.value === 'string' && field.value.trim() !== '';
}

/** Required fields the signer still has to complete, in document order. */
export function remainingFields(
  packet: Pick<Packet, 'fields' | 'documents'>,
  recipient: Recipient
): PacketField[] {
  return inDocumentOrder(packet, fieldsFor(packet, recipient.id)).filter(
    (field) => field.required && !isFieldComplete(field, recipient)
  );
}

/** Order fields by document, page, then top-to-bottom and left-to-right. */
export function inDocumentOrder(
  packet: Pick<Packet, 'documents'>,
  fields: PacketField[]
): PacketField[] {
  const documentIndex = new Map(
    packet.documents.map((document, index) => [document.id, index])
  );
  return [...fields].sort(
    (a, b) =>
      (documentIndex.get(a.documentId) ?? 0) -
        (documentIndex.get(b.documentId) ?? 0) ||
      a.page - b.page ||
      a.box.yPct - b.box.yPct ||
      a.box.xPct - b.box.xPct
  );
}

export type PlacementProblem =
  | { kind: 'no_documents' }
  | { kind: 'no_signers' }
  | { kind: 'no_signature_field'; recipientId: string; documentId?: string };

/**
 * What stops a packet from being sent. A signer with no signature field at
 * all blocks sending; a signer missing one in a single document is reported
 * with that document so the sender can decide.
 */
export function placementProblems(
  packet: Pick<Packet, 'documents' | 'recipients' | 'fields'>
): PlacementProblem[] {
  if (packet.documents.length === 0) return [{ kind: 'no_documents' }];

  const signing = signers(packet);
  if (signing.length === 0) return [{ kind: 'no_signers' }];

  const problems: PlacementProblem[] = [];
  for (const signer of signing) {
    const signatures = fieldsFor(packet, signer.id).filter(
      (field) => field.kind === 'signature'
    );
    if (signatures.length === 0) {
      problems.push({ kind: 'no_signature_field', recipientId: signer.id });
      continue;
    }

    for (const document of packet.documents) {
      const signsDocument = signatures.some(
        (field) => field.documentId === document.id
      );
      if (signsDocument) continue;
      problems.push({
        kind: 'no_signature_field',
        recipientId: signer.id,
        documentId: document.id,
      });
    }
  }
  return problems;
}

/** Problems that must be fixed before sending, as opposed to warnings. */
export function blocksSending(problem: PlacementProblem): boolean {
  if (problem.kind !== 'no_signature_field') return true;
  return problem.documentId === undefined;
}
