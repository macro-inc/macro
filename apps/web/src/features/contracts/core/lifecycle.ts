import { addHours } from 'date-fns';
import { err, ok, type Result } from 'neverthrow';
import {
  blocksSending,
  fieldsBelong,
  isAutoFilled,
  placementProblems,
  remainingFields,
} from './fields';
import {
  type AdoptedSignature,
  DEFAULT_EXPIRATION_DAYS,
  DEFAULT_REMINDER_DAYS,
  type FieldBox,
  type Packet,
  type PacketDocument,
  type PacketEvent,
  type PacketEventType,
  type PacketField,
  type PacketOwner,
  type Recipient,
  type RecipientAccess,
  type SigningOrder,
  signers,
} from './packet';
import { signersToInvite } from './routing';
import { isInFlight, isPastExpiry, packetStatus } from './status';

/** Time and identity supplied by the caller so every transition is pure. */
export type LifecycleContext = {
  now: string;
  newId: () => string;
  newAccess: () => Pick<RecipientAccess, 'token' | 'tokenId'>;
};

export type PacketError =
  | { kind: 'not_draft' }
  | { kind: 'not_in_flight' }
  | { kind: 'cannot_send' }
  | { kind: 'cannot_merge' }
  | { kind: 'no_database' }
  | { kind: 'not_your_turn' }
  | { kind: 'disclosure_required' }
  | { kind: 'signature_field_lost' }
  | { kind: 'signature_missing' }
  | { kind: 'signature_too_large' }
  | { kind: 'fields_misplaced' }
  | { kind: 'fields_incomplete'; fieldIds: string[] }
  | { kind: 'unknown_recipient' };

export type DraftInput = {
  title: string;
  owner: PacketOwner;
  documents: PacketDocument[];
  recipients: Pick<Recipient, 'id' | 'name' | 'email' | 'role' | 'isSender'>[];
  signingOrder: SigningOrder;
  databaseIds: string[];
  company?: string;
  expirationDays?: number;
  reminderDays?: number | null;
};

const HOURS_PER_DAY = 24;

/** Windows and cadences count whole 24-hour days, whatever the time zone. */
function addDays(iso: string, days: number): string {
  return addHours(new Date(iso), days * HOURS_PER_DAY).toISOString();
}

function event(
  context: LifecycleContext,
  type: PacketEventType,
  actor: string,
  extra: Pick<PacketEvent, 'recipientId' | 'note'> = {}
): PacketEvent {
  return { id: context.newId(), type, at: context.now, actor, ...extra };
}

function replaceRecipient(packet: Packet, next: Recipient): Packet {
  return {
    ...packet,
    recipients: packet.recipients.map((recipient) =>
      recipient.id === next.id ? next : recipient
    ),
  };
}

/**
 * Give a signing link to every signer whose turn it is and who has none,
 * and record that each was invited. The event notes the link's public id so
 * the certificate can name the link a signer used without holding its secret.
 */
function invite(packet: Packet, context: LifecycleContext): Packet {
  const invited = signersToInvite(packet).filter((signer) => !signer.access);
  if (invited.length === 0) return packet;

  const access = new Map<string, RecipientAccess>(
    invited.map((signer) => [
      signer.id,
      { ...context.newAccess(), issuedAt: context.now },
    ])
  );
  return {
    ...packet,
    recipients: packet.recipients.map((recipient) => {
      const issued = access.get(recipient.id);
      return issued ? { ...recipient, access: issued } : recipient;
    }),
    events: [
      ...packet.events,
      ...invited.map((signer) =>
        event(context, 'contract.sent', packet.owner.name, {
          recipientId: signer.id,
          note: access.get(signer.id)?.tokenId,
        })
      ),
    ],
  };
}

/** Deactivate every signing link, as a void, decline, or expiry requires. */
function revokeAccess(packet: Packet): Packet {
  return {
    ...packet,
    recipients: packet.recipients.map(({ access: _access, ...rest }) => rest),
  };
}

/** A new draft. Every packet lives in at least one Contracts database. */
export function createDraft(
  input: DraftInput,
  context: LifecycleContext
): Result<Packet, PacketError> {
  if (input.databaseIds.length === 0) return err({ kind: 'no_database' });

  const packet: Packet = {
    id: context.newId(),
    title: input.title,
    owner: input.owner,
    documents: input.documents,
    recipients: input.recipients,
    fields: [],
    signingOrder: input.signingOrder,
    databaseIds: input.databaseIds,
    company: input.company,
    expirationDays: input.expirationDays ?? DEFAULT_EXPIRATION_DAYS,
    reminderDays:
      input.reminderDays === undefined
        ? DEFAULT_REMINDER_DAYS
        : input.reminderDays,
    createdAt: context.now,
    events: [],
  };
  return ok({
    ...packet,
    events: [event(context, 'contract.created', input.owner.name)],
  });
}

/** Replace the placed fields of a draft. */
export function setFields(
  packet: Packet,
  fields: PacketField[],
  context: Pick<LifecycleContext, 'now'>
): Result<Packet, PacketError> {
  if (packetStatus(packet, context.now) !== 'draft') {
    return err({ kind: 'not_draft' });
  }
  if (!fieldsBelong(packet, fields)) return err({ kind: 'fields_misplaced' });
  return ok({ ...packet, fields });
}

/**
 * Send a draft: open the signing window and invite whoever signs first.
 * A packet with no documents, no signers, or a signer who has no signature
 * field cannot be sent.
 */
export function sendPacket(
  packet: Packet,
  context: LifecycleContext
): Result<Packet, PacketError> {
  if (packetStatus(packet, context.now) !== 'draft') {
    return err({ kind: 'not_draft' });
  }
  if (placementProblems(packet).some(blocksSending)) {
    return err({ kind: 'cannot_send' });
  }

  const sent: Packet = {
    ...packet,
    sentAt: context.now,
    expiresAt: addDays(context.now, packet.expirationDays),
  };
  return ok(invite(sent, context));
}

/** The signer opened their link. Only the first view is recorded. */
export function recordView(
  packet: Packet,
  token: string,
  userAgent: string,
  context: LifecycleContext
): Result<Packet, PacketError> {
  const recipient = activeRecipient(packet, token, context.now);
  if (recipient.isErr()) return err(recipient.error);
  if (recipient.value.viewedAt) return ok(packet);

  const viewed = replaceRecipient(packet, {
    ...recipient.value,
    viewedAt: context.now,
    userAgent,
  });
  return ok({
    ...viewed,
    events: [
      ...viewed.events,
      event(context, 'contract.viewed', recipient.value.name, {
        recipientId: recipient.value.id,
      }),
    ],
  });
}

/** The signer agreed to sign electronically. */
export function acceptDisclosure(
  packet: Packet,
  token: string,
  context: LifecycleContext
): Result<Packet, PacketError> {
  const recipient = activeRecipient(packet, token, context.now);
  if (recipient.isErr()) return err(recipient.error);
  if (recipient.value.disclosureAcceptedAt) return ok(packet);

  const accepted = replaceRecipient(packet, {
    ...recipient.value,
    disclosureAcceptedAt: context.now,
  });
  return ok({
    ...accepted,
    events: [
      ...accepted.events,
      event(context, 'audit.disclosure_accepted', recipient.value.name, {
        recipientId: recipient.value.id,
      }),
    ],
  });
}

/** The signature and initials a signer chose to sign with. */
export type Adoption = {
  signature: AdoptedSignature;
  initials: AdoptedSignature;
};

export type SigningInput = Adoption & {
  /** Values the signer entered, keyed by field id. */
  values: Record<string, string | boolean>;
};

/**
 * Apply a signer's signature. They must have accepted the disclosure and
 * completed their required fields; the date, name, and email fields are
 * filled for them. Signing invites the next
 * signer of a sequential packet and completes the packet after the last one.
 */
export function signPacket(
  packet: Packet,
  token: string,
  input: SigningInput,
  context: LifecycleContext
): Result<Packet, PacketError> {
  const found = activeRecipient(packet, token, context.now);
  if (found.isErr()) return err(found.error);
  // Consent to sign electronically is its own recorded step, never implied.
  if (!found.value.disclosureAcceptedAt) {
    return err({ kind: 'disclosure_required' });
  }
  if (isBlank(input.signature) || isBlank(input.initials)) {
    return err({ kind: 'signature_missing' });
  }
  if (isTooLarge(input.signature) || isTooLarge(input.initials)) {
    return err({ kind: 'signature_too_large' });
  }

  const { access: _access, ...withoutAccess } = found.value;
  const signer: Recipient = {
    ...withoutAccess,
    signature: input.signature,
    initials: input.initials,
    signedAt: context.now,
  };

  const filled: Packet = {
    ...replaceRecipient(packet, signer),
    fields: packet.fields.map((field) => fillField(field, signer, input)),
  };
  const missing = remainingFields(filled, signer);
  if (missing.length > 0) {
    return err({
      kind: 'fields_incomplete',
      fieldIds: missing.map((field) => field.id),
    });
  }

  const signed: Packet = {
    ...filled,
    events: [
      ...filled.events,
      event(context, 'contract.signed_by_recipient', signer.name, {
        recipientId: signer.id,
      }),
    ],
  };

  const everyoneSigned = signers(signed).every((each) => each.signedAt);
  if (!everyoneSigned) return ok(invite(signed, context));

  return ok({
    ...signed,
    completedAt: context.now,
    events: [...signed.events, event(context, 'contract.completed', 'Macro')],
  });
}

function fillField(
  field: PacketField,
  signer: Recipient,
  input: SigningInput
): PacketField {
  if (field.recipientId !== signer.id) return field;
  if (field.kind === 'date_signed') return { ...field, value: signer.signedAt };
  if (field.kind === 'full_name') return { ...field, value: signer.name };
  if (field.kind === 'email') return { ...field, value: signer.email };
  if (isAutoFilled(field.kind)) return field;

  // Only what the field's kind takes is kept: text for a text field, a
  // tick for a checkbox. Marks render from the adopted signature.
  const entered = input.values[field.id];
  if (field.kind === 'text' && typeof entered === 'string') {
    return { ...field, value: entered };
  }
  if (field.kind === 'checkbox' && typeof entered === 'boolean') {
    return { ...field, value: entered };
  }
  return field;
}

function isBlank(mark: AdoptedSignature): boolean {
  if (mark.kind === 'typed') return mark.text.trim() === '';
  return mark.dataUrl === '';
}

/**
 * The longest drawn or uploaded mark a packet keeps, in data-URL characters:
 * about 300 KB of image. A packet stores each signer's mark in full.
 */
export const MAX_MARK_LENGTH = 400_000;

function isTooLarge(mark: AdoptedSignature): boolean {
  return mark.kind !== 'typed' && mark.dataUrl.length > MAX_MARK_LENGTH;
}

/** The signer refused. Their link and everyone else's stop working. */
export function declinePacket(
  packet: Packet,
  token: string,
  reason: string,
  context: LifecycleContext
): Result<Packet, PacketError> {
  const recipient = activeRecipient(packet, token, context.now);
  if (recipient.isErr()) return err(recipient.error);

  const declined = replaceRecipient(packet, {
    ...recipient.value,
    declinedAt: context.now,
    declineReason: reason,
  });
  return ok({
    ...revokeAccess(declined),
    events: [
      ...declined.events,
      event(context, 'contract.declined', recipient.value.name, {
        recipientId: recipient.value.id,
        note: reason || undefined,
      }),
    ],
  });
}

/** The sender cancelled an in-flight packet. */
export function voidPacket(
  packet: Packet,
  reason: string,
  context: LifecycleContext
): Result<Packet, PacketError> {
  if (!isInFlight(packetStatus(packet, context.now))) {
    return err({ kind: 'not_in_flight' });
  }
  return ok({
    ...revokeAccess(packet),
    voidedAt: context.now,
    voidReason: reason,
    events: [
      ...packet.events,
      event(context, 'contract.voided', packet.owner.name, {
        note: reason || undefined,
      }),
    ],
  });
}

/**
 * Record that the signing window closed. Safe to call on every read: a
 * packet that has not expired, or already recorded it, is returned as is.
 */
export function expireIfDue(packet: Packet, context: LifecycleContext): Packet {
  if (packet.expiredAt) return packet;
  if (!isPastExpiry(packet, context.now)) return packet;
  if (packetStatus(packet, context.now) !== 'expired') return packet;

  return {
    ...revokeAccess(packet),
    expiredAt: packet.expiresAt,
    events: [...packet.events, event(context, 'contract.expired', 'Macro')],
  };
}

/** Nudge every signer whose turn it is. */
/** Who an automatic step is recorded as, where no person caused it. */
const SYSTEM_ACTOR = 'Macro';

export function remindPending(
  packet: Packet,
  context: LifecycleContext,
  actor: string = packet.owner.name
): Result<Packet, PacketError> {
  if (!isInFlight(packetStatus(packet, context.now))) {
    return err({ kind: 'not_in_flight' });
  }
  const pending = signersToInvite(packet);
  return ok({
    ...packet,
    lastReminderAt: context.now,
    events: [
      ...packet.events,
      ...pending.map((signer) =>
        event(context, 'audit.reminder_sent', actor, {
          recipientId: signer.id,
        })
      ),
    ],
  });
}

/** When the next automatic reminder is due, if the packet sends them. */
export function nextReminderAt(
  packet: Pick<
    Packet,
    'reminderDays' | 'sentAt' | 'lastReminderAt' | 'recipients' | 'signingOrder'
  >
): string | undefined {
  if (packet.reminderDays === null || !packet.sentAt) return undefined;

  // A reminder counts from the latest moment a pending signer was contacted.
  const invitedAt = signersToInvite(packet)
    .map((signer) => signer.access?.issuedAt)
    .filter((issuedAt) => issuedAt !== undefined);
  const contacted = [packet.sentAt, packet.lastReminderAt, ...invitedAt]
    .filter((at) => at !== undefined)
    .sort();
  const latest = contacted[contacted.length - 1];
  return latest ? addDays(latest, packet.reminderDays) : undefined;
}

/**
 * Swap one document of an in-flight packet for a revised one. Earlier
 * signatures no longer apply to the new text, so every signing link is
 * voided, signatures and entered values are cleared, and the first signers
 * are invited again. The document's fields stay where they were placed,
 * except those on pages the revision no longer has; a revision that would
 * leave a signer with no signature field at all is refused.
 */
export function replaceDocument(
  packet: Packet,
  documentId: string,
  replacement: PacketDocument,
  context: LifecycleContext
): Result<Packet, PacketError> {
  if (!isInFlight(packetStatus(packet, context.now))) {
    return err({ kind: 'not_in_flight' });
  }

  const fields = packet.fields.flatMap(({ value: _value, ...field }) => {
    if (field.documentId !== documentId) return [field];
    if (field.page >= replacement.pageCount) return [];
    return [{ ...field, documentId: replacement.id }];
  });
  const revised: Packet = {
    ...packet,
    documents: packet.documents.map((document) =>
      document.id === documentId ? replacement : document
    ),
    fields,
    recipients: packet.recipients.map(resetRecipient),
    events: [
      ...packet.events,
      event(context, 'audit.documents_replaced', packet.owner.name, {
        note: replacement.name,
      }),
    ],
  };
  // A shorter revision can drop the page a signer's only signature sat on.
  // Sending it would ask them to sign a packet with nowhere to sign.
  if (placementProblems(revised).some(blocksSending)) {
    return err({ kind: 'signature_field_lost' });
  }
  return ok(invite(revised, context));
}

/**
 * Remind the pending signers when the packet's cadence says a reminder is
 * due. The packet is returned unchanged when none is.
 */
export function remindIfDue(packet: Packet, context: LifecycleContext): Packet {
  if (!isInFlight(packetStatus(packet, context.now))) return packet;
  const due = nextReminderAt(packet);
  if (!due || due > context.now) return packet;
  return remindPending(packet, context, SYSTEM_ACTOR).unwrapOr(packet);
}

const sameEmail = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const sameBox = (a: FieldBox, b: FieldBox) =>
  a.xPct === b.xPct &&
  a.yPct === b.yPct &&
  a.widthPct === b.widthPct &&
  a.heightPct === b.heightPct;

/** Whether a packet can still take part in a merge: a draft or in flight. */
export function canMerge(packet: Packet, now: string): boolean {
  const status = packetStatus(packet, now);
  return status === 'draft' || isInFlight(status);
}

/**
 * Fold `source` into `target`, for a packet that was created by mistake
 * instead of updating an existing one. The target gains the source's
 * documents, recipients, fields, and databases; a document with the same
 * bytes and a recipient with the same email are kept once. The source's
 * log is kept whole under `merged`, and the caller removes the source.
 *
 * A draft target stays a draft. An in-flight target now covers documents
 * its signers have not seen, so, as when a document is replaced, every link
 * is voided, signatures are cleared, and the first signers are invited
 * again; that is refused if a signer would have nowhere to sign.
 */
export function mergePackets(
  target: Packet,
  source: Packet,
  context: LifecycleContext
): Result<Packet, PacketError> {
  if (target.id === source.id) return err({ kind: 'cannot_merge' });
  if (!canMerge(target, context.now) || !canMerge(source, context.now)) {
    return err({ kind: 'cannot_merge' });
  }
  const inFlight = packetStatus(target, context.now) !== 'draft';

  const mergedDocuments = mergeDocuments(target, source);
  if (!mergedDocuments) return err({ kind: 'cannot_merge' });
  const { documents, documentIds } = mergedDocuments;
  const { recipients, recipientIds } = mergeRecipients(
    target,
    source,
    inFlight,
    context
  );
  const fields = mergeFields(
    target.fields.map((field) => (inFlight ? withoutValue(field) : field)),
    source.fields.map((field) => ({
      ...withoutValue(field),
      documentId: documentIds.get(field.documentId) ?? field.documentId,
      recipientId: recipientIds.get(field.recipientId) ?? field.recipientId,
    })),
    context
  );

  const merged: Packet = {
    ...target,
    documents,
    recipients,
    fields,
    databaseIds: [...new Set([...target.databaseIds, ...source.databaseIds])],
    company: target.company ?? source.company,
    events: [
      ...target.events,
      event(context, 'audit.packets_merged', target.owner.name, {
        note: source.title,
      }),
    ],
    merged: [
      ...(target.merged ?? []),
      ...(source.merged ?? []),
      {
        id: source.id,
        title: source.title,
        mergedAt: context.now,
        recipients: source.recipients.map(({ id, name }) => ({ id, name })),
        events: source.events,
      },
    ],
  };
  if (!inFlight) return ok(merged);

  if (placementProblems(merged).some(blocksSending)) {
    return err({ kind: 'cannot_send' });
  }
  return ok(invite(merged, context));
}

/**
 * The target's documents plus the source's; the same bytes are kept once.
 * Two different documents under one id cannot both be kept, since fields and
 * stored bytes are found by that id, so such a pair is not merged at all.
 */
function mergeDocuments(target: Packet, source: Packet) {
  const documents = [...target.documents];
  const documentIds = new Map<string, string>();
  for (const document of source.documents) {
    const clash = documents.find(
      (each) => each.id === document.id && each.sha256 !== document.sha256
    );
    if (clash) return undefined;

    const same = documents.find((each) => each.sha256 === document.sha256);
    documentIds.set(document.id, same?.id ?? document.id);
    if (!same) documents.push(document);
  }
  return { documents, documentIds };
}

/** Both packets' recipients; one email is one recipient. */
function mergeRecipients(
  target: Packet,
  source: Packet,
  inFlight: boolean,
  context: LifecycleContext
) {
  const recipients = inFlight
    ? target.recipients.map(resetRecipient)
    : [...target.recipients];
  const recipientIds = new Map<string, string>();
  for (const recipient of source.recipients) {
    const index = recipients.findIndex((each) =>
      sameEmail(each.email, recipient.email)
    );
    const same = recipients[index];
    if (same) {
      recipientIds.set(recipient.id, same.id);
      // Someone who signs in either packet signs the merged one.
      if (recipient.role === 'signer' && same.role === 'copy') {
        recipients[index] = { ...same, role: 'signer' };
      }
      continue;
    }
    const taken = recipients.some((each) => each.id === recipient.id);
    const id = taken ? context.newId() : recipient.id;
    recipientIds.set(recipient.id, id);
    recipients.splice(insertionIndex(recipients, recipient.role), 0, {
      ...resetRecipient(recipient),
      id,
    });
  }
  return { recipients, recipientIds };
}

/**
 * Where a recipient joining a packet goes in its order. A signer signs after
 * the signers already there, but before a sender who countersigns last; a
 * copy recipient goes to the end.
 */
function insertionIndex(
  recipients: readonly Recipient[],
  role: Recipient['role']
): number {
  if (role === 'copy') return recipients.length;
  const lastSigner = recipients.findLastIndex((each) => each.role === 'signer');
  if (lastSigner === -1) return 0;
  return recipients[lastSigner].isSender ? lastSigner : lastSigner + 1;
}

/** The same field placed in both packets is one field. */
function mergeFields(
  fields: PacketField[],
  added: PacketField[],
  context: LifecycleContext
): PacketField[] {
  const merged = [...fields];
  for (const field of added) {
    const duplicate = merged.some(
      (each) =>
        each.documentId === field.documentId &&
        each.page === field.page &&
        each.recipientId === field.recipientId &&
        each.kind === field.kind &&
        sameBox(each.box, field.box)
    );
    if (duplicate) continue;
    const taken = merged.some((each) => each.id === field.id);
    merged.push(taken ? { ...field, id: context.newId() } : field);
  }
  return merged;
}

function withoutValue({ value: _value, ...field }: PacketField): PacketField {
  return field;
}

function resetRecipient(recipient: Recipient): Recipient {
  return {
    id: recipient.id,
    name: recipient.name,
    email: recipient.email,
    role: recipient.role,
    isSender: recipient.isSender,
  };
}

/** Mark a packet signed outside Macro, such as in wet ink. */
export function markSignedOffline(
  packet: Packet,
  by: string,
  context: LifecycleContext
): Result<Packet, PacketError> {
  // Only a packet that was sent and is not already closed for good.
  const status = packetStatus(packet, context.now);
  if (status === 'draft' || status === 'signed' || status === 'voided') {
    return err({ kind: 'not_in_flight' });
  }
  return ok({
    ...revokeAccess(packet),
    statusOverride: { status: 'signed', tag: 'offline', by, at: context.now },
    completedAt: context.now,
    events: [
      ...packet.events,
      event(context, 'audit.status_overridden', by, {
        note: 'Signed (Offline)',
      }),
    ],
  });
}

/**
 * The recipient this token belongs to, if they may act now. An expired,
 * voided, or completed packet has no active links.
 */
function activeRecipient(
  packet: Packet,
  token: string,
  now: string
): Result<Recipient, PacketError> {
  if (!isInFlight(packetStatus(packet, now))) {
    return err({ kind: 'not_in_flight' });
  }
  const recipient = packet.recipients.find(
    (each) => each.access?.token === token
  );
  if (!recipient) return err({ kind: 'not_your_turn' });
  return ok(recipient);
}
