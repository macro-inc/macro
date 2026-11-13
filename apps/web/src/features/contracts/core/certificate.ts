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
 * each signature. The last signature's digest is final only once every
 * signer has signed.
 */
function certificateHashes(packet: Packet): CertificateHash[] {
  // Replacing a document, or merging another packet in, voids every earlier
  // signature, so only the events after the latest of those describe what
  // was finally signed.
  const replaced = packet.events.findLastIndex(
    (event) =>
      event.type === 'audit.documents_replaced' ||
      event.type === 'audit.packets_merged'
  );
  const current = packet.events.slice(replaced + 1);
  const hashes: CertificateHash[] = [];

  const sent = current.find((event) => event.type === 'contract.sent');
  if (sent?.stateHash) {
    hashes.push({ step: 'before_signing', hash: sent.stateHash });
  }

  const signatures = current.filter(
    (event) => event.type === 'contract.signed_by_recipient' && event.stateHash
  );
  const everyoneSigned = signers(packet).every((signer) => signer.signedAt);
  for (const [index, signature] of signatures.entries()) {
    if (!signature.stateHash) continue;
    hashes.push({
      step: 'after_signer',
      hash: signature.stateHash,
      signerName: signature.actor,
      final: everyoneSigned && index === signatures.length - 1,
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

/** The log of a packet that was merged into this one, readable on its own. */
export type MergedHistory = {
  id: string;
  title: string;
  mergedAt: string;
  events: CertificateEvent[];
};

/** Every packet merged into this one, oldest first, with its log named. */
export function mergedHistories(packet: Packet): MergedHistory[] {
  return (packet.merged ?? []).map((merged) => {
    const names = new Map(
      merged.recipients.map((recipient) => [recipient.id, recipient.name])
    );
    return {
      id: merged.id,
      title: merged.title,
      mergedAt: merged.mergedAt,
      events: merged.events.map((event) => ({
        id: event.id,
        at: event.at,
        type: event.type,
        actor: event.actor,
        recipientName: event.recipientId
          ? names.get(event.recipientId)
          : undefined,
        note: event.note,
      })),
    };
  });
}
