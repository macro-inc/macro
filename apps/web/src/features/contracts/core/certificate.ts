import type {
  AdoptedSignature,
  Packet,
  PacketEvent,
  PacketEventType,
} from './packet';
import { findRecipient, signers } from './packet';

export type CertificateSigner = {
  id: string;
  name: string;
  email: string;
  /** One-based position among the packet's signers. */
  position: number;
  signerCount: number;
  signature?: AdoptedSignature;
  tokenId?: string;
  userAgent?: string;
  disclosureAcceptedAt?: string;
  signedAt?: string;
};

export type CertificateHash =
  | { step: 'before_signing'; hash: string }
  | { step: 'after_signer'; hash: string; signerName: string; final: boolean };

export type CertificateEvent = {
  id: string;
  at: string;
  type: PacketEventType;
  actor: string;
  recipientName?: string;
  note?: string;
};

/** Everything the Certificate of Completion page prints. */
export type Certificate = {
  envelopeId: string;
  title: string;
  sender: string;
  createdAt: string;
  completedAt?: string;
  documents: { name: string; pageCount: number }[];
  signingOrder: Packet['signingOrder'];
  copyRecipients: string[];
  signers: CertificateSigner[];
  hashes: CertificateHash[];
  events: CertificateEvent[];
};

/**
 * The state digests the certificate lists: the packet as sent, then after
 * each signature. The last signature's digest is the final one.
 */
function certificateHashes(packet: Packet): CertificateHash[] {
  const hashes: CertificateHash[] = [];

  const sent = packet.events.find((event) => event.type === 'contract.sent');
  if (sent?.stateHash) {
    hashes.push({ step: 'before_signing', hash: sent.stateHash });
  }

  const signatures = packet.events.filter(
    (event) => event.type === 'contract.signed_by_recipient' && event.stateHash
  );
  for (const [index, signature] of signatures.entries()) {
    if (!signature.stateHash) continue;
    hashes.push({
      step: 'after_signer',
      hash: signature.stateHash,
      signerName: signature.actor,
      final: index === signatures.length - 1,
    });
  }
  return hashes;
}

function certificateEvent(
  packet: Packet,
  event: PacketEvent
): CertificateEvent {
  const recipient = event.recipientId
    ? findRecipient(packet, event.recipientId)
    : undefined;
  return {
    id: event.id,
    at: event.at,
    type: event.type,
    actor: event.actor,
    recipientName: recipient?.name,
    note: event.note,
  };
}

/** The signing link id each signer used, read from the invitation log. */
function tokenIds(packet: Packet): Map<string, string> {
  const ids = new Map<string, string>();
  for (const event of packet.events) {
    if (event.type !== 'contract.sent' || !event.recipientId) continue;
    if (event.note) ids.set(event.recipientId, event.note);
  }
  return ids;
}

export function buildCertificate(packet: Packet): Certificate {
  const signing = signers(packet);
  const issued = tokenIds(packet);

  return {
    envelopeId: packet.id,
    title: packet.title,
    sender: packet.owner.name,
    createdAt: packet.createdAt,
    completedAt: packet.completedAt,
    documents: packet.documents.map((document) => ({
      name: document.name,
      pageCount: document.pageCount,
    })),
    signingOrder: packet.signingOrder,
    copyRecipients: packet.recipients
      .filter((recipient) => recipient.role === 'copy')
      .map((recipient) => recipient.name),
    signers: signing.map((signer, index) => ({
      id: signer.id,
      name: signer.name,
      email: signer.email,
      position: index + 1,
      signerCount: signing.length,
      signature: signer.signature,
      tokenId: issued.get(signer.id),
      userAgent: signer.userAgent,
      disclosureAcceptedAt: signer.disclosureAcceptedAt,
      signedAt: signer.signedAt,
    })),
    hashes: certificateHashes(packet),
    events: packet.events.map((event) => certificateEvent(packet, event)),
  };
}
