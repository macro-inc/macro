import type { Packet, PacketStatus } from './packet';
import { signersToInvite } from './routing';
import {
  isInFlight,
  packetStatus,
  type SignerProgress,
  signerProgress,
} from './status';

/** A packet as a database row shows it. */
export type PacketRow = {
  packet: Packet;
  status: PacketStatus;
  progress: SignerProgress;
  /** The viewer is a signer and it is their turn. */
  awaitsViewer: boolean;
};

export const PACKET_FILTERS = [
  'all',
  'in_flight',
  'needs_my_signature',
  'completed',
] as const;
export type PacketFilter = (typeof PACKET_FILTERS)[number];

export function toPacketRow(packet: Packet, now: string): PacketRow {
  const status = packetStatus(packet, now);
  return {
    packet,
    status,
    progress: signerProgress(packet),
    awaitsViewer:
      isInFlight(status) &&
      signersToInvite(packet).some((signer) => signer.isSender),
  };
}

export function matchesFilter(row: PacketRow, filter: PacketFilter): boolean {
  if (filter === 'in_flight') return isInFlight(row.status);
  if (filter === 'needs_my_signature') return row.awaitsViewer;
  if (filter === 'completed') return row.status === 'signed';
  return true;
}

/** Rows of one database, newest first. */
export function databaseRows(
  packets: readonly Packet[],
  databaseId: string,
  now: string
): PacketRow[] {
  return packets
    .filter((packet) => packet.databaseIds.includes(databaseId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((packet) => toPacketRow(packet, now));
}

/** Rows across every database, newest first, each packet once. */
export function allRows(packets: readonly Packet[], now: string): PacketRow[] {
  return [...packets]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((packet) => toPacketRow(packet, now));
}
