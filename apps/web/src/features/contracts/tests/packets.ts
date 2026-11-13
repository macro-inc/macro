import { createHash } from 'node:crypto';
import type { Digest } from '../core/audit';
import {
  acceptDisclosure,
  createDraft,
  type DraftInput,
  type LifecycleContext,
  type SigningInput,
  setFields,
  signPacket,
} from '../core/lifecycle';
import type { Packet, PacketField } from '../core/packet';

/** A deterministic clock and id source for lifecycle tests. */
export function testContext(now = '2026-11-09T21:02:11.000Z') {
  let ids = 0;
  let tokens = 0;
  const context: LifecycleContext & { at(now: string): LifecycleContext } = {
    now,
    newId: () => `id-${++ids}`,
    newAccess: () => {
      tokens += 1;
      return { token: `token-${tokens}`, tokenId: `tok_${tokens}` };
    },
    at(next: string) {
      return { ...context, now: next };
    },
  };
  return context;
}

export const sha256: Digest = async (text) =>
  createHash('sha256').update(text).digest('hex');

export const SARAH = 'sarah';
export const AVERY = 'avery';
const DANA = 'dana';

export const ACME_DRAFT: DraftInput = {
  title: 'Acme MSA',
  owner: { id: 'owner', name: 'Avery Lee' },
  documents: [
    {
      id: 'order-form',
      name: 'Order Form',
      pageCount: 2,
      source: 'drive',
      sha256: 'a'.repeat(64),
    },
    {
      id: 'msa',
      name: 'Master Services Agreement',
      pageCount: 14,
      source: 'drive',
      convertedFrom: 'docx',
      sha256: 'b'.repeat(64),
    },
  ],
  recipients: [
    {
      id: SARAH,
      name: 'Sarah Chen',
      email: 'sarah.chen@acme.example',
      role: 'signer',
      isSender: false,
    },
    {
      id: AVERY,
      name: 'Avery Lee',
      email: 'avery.lee@macro.example',
      role: 'signer',
      isSender: true,
    },
    {
      id: DANA,
      name: 'Dana Whitfield',
      email: 'dana.whitfield@acme.example',
      role: 'copy',
      isSender: false,
    },
  ],
  signingOrder: 'sequential',
  databaseIds: ['customer-agreements'],
};

const BOX = { xPct: 0.1, yPct: 0.7, widthPct: 0.3, heightPct: 0.05 };

export const ACME_FIELDS: PacketField[] = [
  {
    id: 'sarah-signature',
    documentId: 'msa',
    page: 13,
    recipientId: SARAH,
    kind: 'signature',
    required: true,
    box: BOX,
  },
  {
    id: 'sarah-title',
    documentId: 'msa',
    page: 13,
    recipientId: SARAH,
    kind: 'text',
    required: true,
    box: { ...BOX, yPct: 0.8 },
  },
  {
    id: 'sarah-date',
    documentId: 'msa',
    page: 13,
    recipientId: SARAH,
    kind: 'date_signed',
    required: true,
    box: { ...BOX, yPct: 0.85 },
  },
  {
    id: 'sarah-order-signature',
    documentId: 'order-form',
    page: 1,
    recipientId: SARAH,
    kind: 'signature',
    required: true,
    box: BOX,
  },
  {
    id: 'avery-signature',
    documentId: 'msa',
    page: 13,
    recipientId: AVERY,
    kind: 'signature',
    required: true,
    box: { ...BOX, xPct: 0.55 },
  },
  {
    id: 'avery-order-signature',
    documentId: 'order-form',
    page: 1,
    recipientId: AVERY,
    kind: 'signature',
    required: true,
    box: { ...BOX, xPct: 0.55 },
  },
];

/** A draft Acme packet with fields placed for both signers. */
export function acmeDraft(
  context: LifecycleContext,
  overrides: Partial<DraftInput> = {}
): Packet {
  const draft = createDraft(
    { ...ACME_DRAFT, ...overrides },
    context
  )._unsafeUnwrap();
  return setFields(draft, ACME_FIELDS, context)._unsafeUnwrap();
}

export const TYPED_SIGNATURE = {
  signature: { kind: 'typed', text: 'Sarah Chen', style: 'script-1' },
  initials: { kind: 'typed', text: 'SC', style: 'script-1' },
} as const;

/** Accept the disclosure and sign, as the signing page does on Finish. */
export function signAs(
  packet: Packet,
  token: string,
  input: SigningInput,
  context: LifecycleContext
) {
  return acceptDisclosure(packet, token, context).andThen((accepted) =>
    signPacket(accepted, token, input, context)
  );
}
