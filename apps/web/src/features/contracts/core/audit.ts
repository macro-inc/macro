import type { Packet, PacketEvent } from './packet';

/** SHA-256 of a UTF-8 string as lowercase hex. Supplied by the platform. */
export type Digest = (text: string) => Promise<string>;

/** Hash that starts every packet's event chain. */
const GENESIS = '0'.repeat(64);

/**
 * The signable state of a packet as stable text: each document's bytes hash,
 * every field's owner, position, and value, and the mark each signer signed
 * with, in a fixed order. Two packets with the same text have the same
 * documents, the same placement, the same answers, and the same signatures.
 */
function packetStateText(
  packet: Pick<Packet, 'id' | 'documents' | 'fields' | 'recipients'>
): string {
  const documents = packet.documents.map((document) => [
    document.id,
    document.sha256,
  ]);
  const fields = [...packet.fields]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((field) => [
      field.id,
      field.documentId,
      field.page,
      field.recipientId,
      field.kind,
      field.required,
      [field.box.xPct, field.box.yPct, field.box.widthPct, field.box.heightPct],
      field.value ?? null,
    ]);
  const signatures = packet.recipients
    .filter((recipient) => recipient.signedAt)
    .map((recipient) => [
      recipient.id,
      recipient.signedAt,
      recipient.signature ?? null,
      recipient.initials ?? null,
    ]);
  return JSON.stringify({ packet: packet.id, documents, fields, signatures });
}

function eventText(event: PacketEvent, previousHash: string): string {
  return JSON.stringify([
    previousHash,
    event.id,
    event.type,
    event.at,
    event.actor,
    event.recipientId ?? null,
    event.note ?? null,
    event.stateHash ?? null,
  ]);
}

/**
 * Seal every event that has no hash yet. Each new event records a digest of
 * the packet's state when it was sealed and a digest chaining it to the event
 * before it, so removing or editing an earlier entry breaks every later hash.
 * Already sealed events are left untouched.
 */
export async function sealEvents(
  packet: Packet,
  digest: Digest
): Promise<Packet> {
  if (packet.events.every((event) => event.hash)) return packet;

  const stateHash = await digest(packetStateText(packet));
  const sealed: PacketEvent[] = [];
  let previousHash = GENESIS;

  for (const event of packet.events) {
    if (event.hash) {
      sealed.push(event);
      previousHash = event.hash;
      continue;
    }

    const withState = { ...event, stateHash };
    const hash = await digest(eventText(withState, previousHash));
    sealed.push({ ...withState, hash });
    previousHash = hash;
  }
  return { ...packet, events: sealed };
}

/**
 * The index of the first event whose hash does not follow from the chain,
 * or `undefined` when every entry present is consistent with the one before.
 * That catches an entry edited, inserted, or removed while the later hashes
 * were left as they were. It is not proof of authenticity or completeness:
 * whoever holds the log can rewrite entries and recompute every later hash,
 * or cut entries from the end. Both need the last hash kept somewhere the
 * holder cannot change, which the signing engine will provide.
 */
export async function firstBrokenEvent(
  events: PacketEvent[],
  digest: Digest
): Promise<number | undefined> {
  let previousHash = GENESIS;

  for (const [index, event] of events.entries()) {
    if (!event.hash) return index;
    const expected = await digest(eventText(event, previousHash));
    if (expected !== event.hash) return index;
    previousHash = event.hash;
  }
  return undefined;
}
