import type { Packet, PacketEvent } from './packet';

/** SHA-256 of a UTF-8 string as lowercase hex. Supplied by the platform. */
export type Digest = (text: string) => Promise<string>;

/** Hash that starts every packet's event chain. */
const GENESIS = '0'.repeat(64);

/**
 * The signable state of a packet as stable text: each document's bytes hash
 * and every field's owner, position, and value, in a fixed order. Two packets
 * with the same text have the same documents and the same answers.
 */
function packetStateText(
  packet: Pick<Packet, 'id' | 'documents' | 'fields' | 'recipients'>
): string {
  const signedAt = new Map(
    packet.recipients.map((recipient) => [recipient.id, recipient.signedAt])
  );
  const fields = [...packet.fields]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((field) => [
      field.id,
      field.documentId,
      field.page,
      field.recipientId,
      field.kind,
      field.value ?? null,
      signedAt.get(field.recipientId) ?? null,
    ]);
  const documents = packet.documents.map((document) => [
    document.id,
    document.sha256,
  ]);
  return JSON.stringify({ packet: packet.id, documents, fields });
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
 * or `undefined` when the whole log verifies.
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
