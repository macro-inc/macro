import type { Packet, Recipient } from './packet';
import { signers } from './packet';

/**
 * The signers who may sign now. Parallel packets invite every unsigned
 * signer; sequential packets invite only the first unsigned signer, so a
 * later signer waits until everyone before them has signed.
 */
export function signersToInvite(
  packet: Pick<Packet, 'recipients' | 'signingOrder'>
): Recipient[] {
  const waiting = signers(packet).filter((signer) => !signer.signedAt);
  if (packet.signingOrder === 'parallel') return waiting;
  return waiting.slice(0, 1);
}

/** One-based position of a signer among the packet's signers. */
export function signingPosition(
  packet: Pick<Packet, 'recipients'>,
  recipientId: string
): number | undefined {
  const index = signers(packet).findIndex(
    (signer) => signer.id === recipientId
  );
  return index === -1 ? undefined : index + 1;
}
