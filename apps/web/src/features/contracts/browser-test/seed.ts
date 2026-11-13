import { contentHash } from '@core/util/hash';
import { sealEvents } from '../core/audit';
import { STARTER_DATABASES } from '../core/database';
import {
  acceptDisclosure,
  createDraft,
  type DraftInput,
  declinePacket,
  expireIfDue,
  type LifecycleContext,
  markSignedOffline,
  recordView,
  sendPacket,
  setFields,
  signPacket,
  voidPacket,
} from '../core/lifecycle';
import type {
  FieldKind,
  Packet,
  PacketDocument,
  PacketField,
} from '../core/packet';
import { createIndexedDbDocumentBlobs } from '../queries/document-blobs';

import type { ContractsSnapshot } from '../queries/packet-schema';
import {
  FIXTURE_DOCUMENT_STORE,
  FIXTURE_STORAGE_KEY,
} from './fixture-contracts';
import dpaUrl from './fixtures/data-processing-addendum.pdf?url';
import msaUrl from './fixtures/master-services-agreement.pdf?url';
import orderFormUrl from './fixtures/order-form.pdf?url';

const VIEWER = { id: 'fixture-viewer', name: 'Avery Lee' };
const VIEWER_EMAIL = 'avery.lee@macro.example';

/** Where each sample PDF's signature block sits, as fractions of its page. */
const SIGNATURE_PAGES = {
  'order-form': { page: 1, top: 0.26 },
  msa: { page: 2, top: 0.338 },
  dpa: { page: 1, top: 0.238 },
} as const;
type SampleDocument = keyof typeof SIGNATURE_PAGES;

const COLUMNS = { customer: 0.2, provider: 0.602 } as const;

function digestText(text: string) {
  return contentHash(new TextEncoder().encode(text));
}

/** A clock and id source the seed moves forward by hand. */
function scriptedContext() {
  let ids = 0;
  const context: LifecycleContext & { at(now: string): LifecycleContext } = {
    now: '',
    newId: () => `seed-${++ids}`,
    newAccess: () => {
      ids += 1;
      return { token: `seed-token-${ids}`, tokenId: `tok_seed${ids}` };
    },
    at: (now) => ({ ...context, now }),
  };
  return context;
}

function unwrap<T>(result: { isErr(): boolean; _unsafeUnwrap(): T }): T {
  return result._unsafeUnwrap();
}

/** The fields one signer gets on a sample document's signature block. */
function signatureBlock(
  packetId: string,
  document: PacketDocument,
  sample: SampleDocument,
  recipientId: string,
  column: keyof typeof COLUMNS
): PacketField[] {
  const { page, top } = SIGNATURE_PAGES[sample];
  const row = (
    kind: FieldKind,
    offset: number,
    heightPct: number,
    widthPct: number
  ): PacketField => ({
    id: `${packetId}-${document.id}-${recipientId}-${kind}`,
    documentId: document.id,
    page,
    recipientId,
    kind,
    required: true,
    box: { xPct: COLUMNS[column], yPct: top + offset, widthPct, heightPct },
  });

  return [
    row('signature', 0, 0.05, 0.27),
    row('full_name', 0.062, 0.026, 0.27),
    row('text', 0.1, 0.026, 0.27),
    row('date_signed', 0.138, 0.026, 0.16),
  ];
}

async function loadDocument(
  url: string,
  id: string,
  name: string,
  pageCount: number,
  convertedFrom?: 'docx'
): Promise<PacketDocument> {
  const bytes = await (await fetch(url)).arrayBuffer();
  await createIndexedDbDocumentBlobs(FIXTURE_DOCUMENT_STORE).put(id, bytes);
  return {
    id,
    name,
    pageCount,
    source: 'drive',
    convertedFrom,
    sha256: await contentHash(bytes),
  };
}

const TYPED = (name: string, initials: string) =>
  ({
    signature: { kind: 'typed', text: name, style: 'script-1' },
    initials: { kind: 'typed', text: initials, style: 'script-1' },
  }) as const;

/**
 * Write a workspace of sample packets, one in each status, built with the
 * real lifecycle so their logs and hashes are genuine. Runs once per browser
 * profile; a second call leaves existing data alone.
 */
export async function seedDemoPackets() {
  if (localStorage.getItem(FIXTURE_STORAGE_KEY)) return;

  const orderForm = await loadDocument(
    orderFormUrl,
    'fixture-order-form',
    'Order Form',
    2
  );
  const msa = await loadDocument(
    msaUrl,
    'fixture-msa',
    'Master Services Agreement',
    3,
    'docx'
  );
  const dpa = await loadDocument(
    dpaUrl,
    'fixture-dpa',
    'Data Processing Addendum',
    2
  );
  const samples: Record<string, SampleDocument> = {
    [orderForm.id]: 'order-form',
    [msa.id]: 'msa',
    [dpa.id]: 'dpa',
  };

  const context = scriptedContext();
  const databases = [
    ...STARTER_DATABASES.map((database) => ({
      ...database,
      id: database.name.toLowerCase().replaceAll(' ', '-'),
    })),
    { id: 'sales-deals', name: 'Sales Deals', color: 'blue' as const },
    {
      id: 'finance-revenue',
      name: 'Finance / Revenue',
      color: 'pink' as const,
    },
  ];

  type Signer = { id: string; name: string; email: string; self?: boolean };
  function draft(
    at: string,
    input: Pick<DraftInput, 'title' | 'documents' | 'company'> & {
      owner?: string;
      signers: Signer[];
      copies?: Signer[];
      databaseIds?: string[];
      signingOrder?: DraftInput['signingOrder'];
    }
  ): Packet {
    const created = unwrap(
      createDraft(
        {
          title: input.title,
          owner: input.owner ? { id: input.owner, name: input.owner } : VIEWER,
          documents: input.documents,
          recipients: [
            ...input.signers.map((signer) => ({
              id: signer.id,
              name: signer.name,
              email: signer.email,
              role: 'signer' as const,
              isSender: signer.self === true,
            })),
            ...(input.copies ?? []).map((copy) => ({
              id: copy.id,
              name: copy.name,
              email: copy.email,
              role: 'copy' as const,
              isSender: false,
            })),
          ],
          signingOrder: input.signingOrder ?? 'sequential',
          databaseIds: input.databaseIds ?? ['customer-agreements'],
          company: input.company,
        },
        context.at(at)
      )
    );
    const fields = input.documents.flatMap((document) =>
      input.signers.flatMap((signer, index) =>
        signatureBlock(
          created.id,
          document,
          samples[document.id],
          signer.id,
          index === 0 ? 'customer' : 'provider'
        )
      )
    );
    return unwrap(setFields(created, fields, context.at(at)));
  }

  const token = (packet: Packet, recipientId: string) =>
    packet.recipients.find((recipient) => recipient.id === recipientId)?.access
      ?.token ?? '';
  const titles = (packet: Packet, recipientId: string, title: string) =>
    Object.fromEntries(
      packet.fields
        .filter(
          (field) => field.recipientId === recipientId && field.kind === 'text'
        )
        .map((field) => [field.id, title])
    );
  const sign = (
    packet: Packet,
    recipientId: string,
    name: string,
    initials: string,
    title: string,
    at: string
  ) =>
    unwrap(
      signPacket(
        unwrap(
          acceptDisclosure(packet, token(packet, recipientId), context.at(at))
        ),
        token(packet, recipientId),
        {
          ...TYPED(name, initials),
          values: titles(packet, recipientId, title),
        },
        context.at(at)
      )
    );

  const SARAH = {
    id: 'sarah',
    name: 'Sarah Chen',
    email: 'sarah.chen@acme.example',
  };
  const AVERY = {
    id: 'avery',
    name: 'Avery Lee',
    email: VIEWER_EMAIL,
    self: true,
  };

  // Partially signed: the customer has signed, the sender still has to.
  let acme = draft('2026-11-09T21:02:11.000Z', {
    title: 'Acme MSA',
    documents: [orderForm, msa, dpa],
    company: 'Acme Corp',
    signers: [SARAH, AVERY],
    copies: [
      {
        id: 'dana',
        name: 'Dana Whitfield',
        email: 'dana.whitfield@acme.example',
      },
    ],
    databaseIds: ['customer-agreements', 'sales-deals', 'finance-revenue'],
  });
  acme = unwrap(sendPacket(acme, context.at('2026-11-09T21:05:40.000Z')));
  acme = unwrap(
    recordView(
      acme,
      token(acme, 'sarah'),
      'Safari on iPhone',
      context.at('2026-11-10T19:21:03.000Z')
    )
  );
  acme = sign(
    acme,
    'sarah',
    'Sarah Chen',
    'SC',
    'VP, Operations',
    '2026-11-10T19:26:47.000Z'
  );
  acme = unwrap(
    recordView(
      acme,
      token(acme, 'avery'),
      'Chrome on macOS',
      context.at('2026-11-10T19:31:18.000Z')
    )
  );

  let northwind = draft('2026-11-11T15:10:00.000Z', {
    title: 'Northwind Order Form Q4',
    owner: 'Priya Nair',
    documents: [orderForm],
    company: 'Northwind Traders',
    signers: [
      { id: 'n1', name: 'Marco Ruiz', email: 'marco.ruiz@northwind.example' },
      { id: 'n2', name: 'Priya Nair', email: 'priya.nair@macro.example' },
    ],
  });
  northwind = unwrap(
    sendPacket(northwind, context.at('2026-11-11T15:20:00.000Z'))
  );

  let contoso = draft('2026-10-28T14:00:00.000Z', {
    title: 'Contoso Renewal 2027',
    documents: [orderForm, msa],
    company: 'Contoso Health',
    signingOrder: 'parallel',
    signers: [
      { id: 'b1', name: 'Elena Park', email: 'elena.park@contoso.example' },
      AVERY,
    ],
  });
  contoso = unwrap(sendPacket(contoso, context.at('2026-10-28T14:05:00.000Z')));
  contoso = sign(
    contoso,
    'b1',
    'Elena Park',
    'EP',
    'General Counsel',
    '2026-10-29T09:12:00.000Z'
  );
  contoso = sign(
    contoso,
    'avery',
    'Avery Lee',
    'AL',
    'CEO',
    '2026-10-29T16:40:00.000Z'
  );

  const fabrikam = draft('2026-11-12T13:30:00.000Z', {
    title: 'Fabrikam Pilot Agreement',
    owner: 'Tom Okafor',
    documents: [orderForm, msa],
    company: 'Fabrikam Robotics',
    signers: [
      { id: 'k1', name: 'Ines Duarte', email: 'ines.duarte@fabrikam.example' },
      { id: 'k2', name: 'Tom Okafor', email: 'tom.okafor@macro.example' },
    ],
  });

  let tailspin = draft('2026-10-14T10:00:00.000Z', {
    title: 'Tailspin DPA',
    owner: 'Priya Nair',
    documents: [dpa],
    company: 'Tailspin Capital',
    signers: [
      {
        id: 'f1',
        name: 'Noor Haddad',
        email: 'noor.haddad@tailspin.example',
      },
      { id: 'f2', name: 'Priya Nair', email: 'priya.nair@macro.example' },
    ],
  });
  tailspin = unwrap(
    sendPacket(tailspin, context.at('2026-10-14T10:05:00.000Z'))
  );
  tailspin = unwrap(
    markSignedOffline(
      tailspin,
      'Priya Nair',
      context.at('2026-10-20T17:00:00.000Z')
    )
  );

  let wingtip = draft('2026-11-02T11:00:00.000Z', {
    title: 'Wingtip Enterprise Order',
    owner: 'Tom Okafor',
    documents: [orderForm, msa],
    company: 'Wingtip Labs',
    signingOrder: 'parallel',
    signers: [
      { id: 'l1', name: 'Tom Okafor', email: 'tom.okafor@macro.example' },
      { id: 'l2', name: 'Grace Lin', email: 'grace.lin@wingtip.example' },
    ],
  });
  wingtip = unwrap(sendPacket(wingtip, context.at('2026-11-02T11:10:00.000Z')));
  wingtip = sign(
    wingtip,
    'l1',
    'Tom Okafor',
    'TO',
    'Account Executive',
    '2026-11-02T11:15:00.000Z'
  );
  wingtip = unwrap(
    declinePacket(
      wingtip,
      token(wingtip, 'l2'),
      '',
      context.at('2026-11-04T08:30:00.000Z')
    )
  );

  let litware = draft('2026-09-30T12:00:00.000Z', {
    title: 'Litware Reseller Terms',
    owner: 'Tom Okafor',
    documents: [msa],
    company: 'Litware',
    signers: [
      {
        id: 'h1',
        name: 'Jonas Weber',
        email: 'jonas.weber@litware.example',
      },
      { id: 'h2', name: 'Tom Okafor', email: 'tom.okafor@macro.example' },
    ],
  });
  litware = unwrap(sendPacket(litware, context.at('2026-09-30T12:05:00.000Z')));
  litware = expireIfDue(litware, context.at('2026-10-31T00:00:00.000Z'));

  let proseware = draft('2026-10-20T09:00:00.000Z', {
    title: 'Proseware MSA',
    documents: [orderForm, msa, dpa],
    company: 'Proseware Systems',
    signers: [
      { id: 't1', name: 'Maya Brandt', email: 'maya.brandt@proseware.example' },
      AVERY,
    ],
  });
  proseware = unwrap(
    sendPacket(proseware, context.at('2026-10-20T09:05:00.000Z'))
  );
  proseware = unwrap(
    voidPacket(proseware, 'Superseded', context.at('2026-10-22T15:00:00.000Z'))
  );

  const packets = await Promise.all(
    [
      acme,
      northwind,
      contoso,
      fabrikam,
      tailspin,
      wingtip,
      litware,
      proseware,
    ].map((packet) => sealEvents(packet, digestText))
  );
  const snapshot: ContractsSnapshot = { databases, packets };
  localStorage.setItem(FIXTURE_STORAGE_KEY, JSON.stringify(snapshot));
}
