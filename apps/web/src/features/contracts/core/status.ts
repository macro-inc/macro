import type { Packet, PacketStatus, Recipient } from './packet';
import { signers } from './packet';

/**
 * The packet's status. Signer progress drives it; a void, a manual override,
 * and expiry take precedence in that order so a later signature cannot
 * silently revive a packet someone closed.
 */
export function packetStatus(
  packet: Pick<
    Packet,
    | 'recipients'
    | 'sentAt'
    | 'expiresAt'
    | 'expiredAt'
    | 'voidedAt'
    | 'statusOverride'
  >,
  now: string
): PacketStatus {
  if (packet.voidedAt) return 'voided';
  if (packet.statusOverride) return packet.statusOverride.status;
  if (!packet.sentAt) return 'draft';

  const signing = signers(packet);
  if (signing.some((signer) => signer.declinedAt)) return 'declined';

  const signedCount = signing.filter((signer) => signer.signedAt).length;
  if (signing.length > 0 && signedCount === signing.length) return 'signed';

  if (packet.expiredAt || isPastExpiry(packet, now)) return 'expired';
  if (signedCount > 0) return 'partially_signed';
  return 'sent';
}

/** Whether the signing window has closed, whether or not that was recorded. */
export function isPastExpiry(
  packet: Pick<Packet, 'expiresAt'>,
  now: string
): boolean {
  if (!packet.expiresAt) return false;
  return Date.parse(packet.expiresAt) <= Date.parse(now);
}

/** A packet recipients can still act on. */
export function isInFlight(status: PacketStatus): boolean {
  return status === 'sent' || status === 'partially_signed';
}

export type SignerProgress = {
  signed: number;
  total: number;
  /** One entry per signer, in signing order. */
  steps: ('signed' | 'declined' | 'pending')[];
};

export function signerProgress(
  packet: Pick<Packet, 'recipients'>
): SignerProgress {
  const steps = signers(packet).map(signerStep);
  return {
    signed: steps.filter((step) => step === 'signed').length,
    total: steps.length,
    steps,
  };
}

function signerStep(signer: Recipient): SignerProgress['steps'][number] {
  if (signer.signedAt) return 'signed';
  if (signer.declinedAt) return 'declined';
  return 'pending';
}
