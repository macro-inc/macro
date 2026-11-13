import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContractsData } from '../context/contracts-context';
import { findRecipient } from '../core/packet';
import { packetStatus } from '../core/status';
import { fakeBrowser, VIEWER } from '../tests/local-store';
import {
  ACME_DRAFT,
  ACME_FIELDS,
  SARAH,
  TYPED_SIGNATURE,
} from '../tests/packets';
import { LOCAL_CONTRACTS_STORAGE_KEY } from './local-contracts';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function open(browser: ReturnType<typeof fakeBrowser>) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return browser.open();
  });
}

async function sendAcme(contracts: ContractsData) {
  const draft = (await contracts.createDraft(ACME_DRAFT))._unsafeUnwrap();
  (await contracts.saveFields(draft.id, ACME_FIELDS))._unsafeUnwrap();
  return (await contracts.send(draft.id))._unsafeUnwrap();
}

describe('createLocalContracts', () => {
  it('starts with the starter databases and no packets', () => {
    const contracts = open(fakeBrowser()).context(VIEWER);
    expect(contracts.databases().map((database) => database.name)).toEqual([
      'Customer Agreements',
      'Vendor MSAs',
      'NDAs',
      'Offer Letters',
    ]);
    expect(contracts.packets()).toEqual([]);
  });

  it('seals every event it stores', async () => {
    const contracts = open(fakeBrowser()).context(VIEWER);
    const sent = await sendAcme(contracts);

    expect(sent.events.map((event) => event.type)).toEqual([
      'contract.created',
      'contract.sent',
    ]);
    expect(sent.events.every((event) => event.hash?.length === 64)).toBe(true);
    expect(contracts.packets()).toEqual([sent]);
  });

  it('keeps a packet across a reload', async () => {
    const browser = fakeBrowser();
    const sent = await sendAcme(open(browser).context(VIEWER));

    const reopened = open(browser).context(VIEWER);
    expect(reopened.packets()).toEqual([sent]);
  });

  it('ignores a stored snapshot it cannot read', () => {
    const browser = fakeBrowser();
    browser.items.set(LOCAL_CONTRACTS_STORAGE_KEY, '{"packets":"nope"}');
    expect(open(browser).context(VIEWER).packets()).toEqual([]);
  });

  it('refuses a transition on a packet that does not exist', async () => {
    const contracts = open(fakeBrowser()).context(VIEWER);
    expect((await contracts.send('missing'))._unsafeUnwrapErr()).toEqual({
      kind: 'not_found',
    });
  });

  it('runs overlapping writes in turn so neither is lost', async () => {
    const contracts = open(fakeBrowser()).context(VIEWER);
    const [first, second] = await Promise.all([
      contracts.createDraft({ ...ACME_DRAFT, title: 'First' }),
      contracts.createDraft({ ...ACME_DRAFT, title: 'Second' }),
    ]);

    expect(first.isOk() && second.isOk()).toBe(true);
    expect(
      contracts
        .packets()
        .map((packet) => packet.title)
        .sort()
    ).toEqual(['First', 'Second']);
  });

  it('builds the signing link from the recipient token', async () => {
    const contracts = open(fakeBrowser()).context(VIEWER);
    const sent = await sendAcme(contracts);
    const token = findRecipient(sent, SARAH)?.access?.token ?? '';
    expect(contracts.signingUrl(token)).toBe(
      `https://app.example/sign/${token}`
    );
  });
});

describe('importDocument', () => {
  // jsdom's File has no arrayBuffer(), which browsers provide.
  const pdf = (text: string, name: string) =>
    Object.assign(new File([text], name), {
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    });

  it('describes a PDF and stores it for opening', async () => {
    const contracts = open(fakeBrowser()).context(VIEWER);
    const document = (
      await contracts.importDocument(pdf('%PDF-1.7 body', 'Order Form.pdf'))
    )._unsafeUnwrap();

    expect(document).toMatchObject({
      name: 'Order Form',
      pageCount: 3,
      source: 'upload',
      sha256: 'f'.repeat(64),
    });
    expect((await contracts.openDocument(document.id)).isOk()).toBe(true);
  });

  it('refuses a file that is not a PDF', async () => {
    const contracts = open(fakeBrowser()).context(VIEWER);
    const result = await contracts.importDocument(
      pdf('PK zip bytes', 'Agreement.docx')
    );
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'not_pdf' });
  });

  it('reports a document whose bytes are gone', async () => {
    const contracts = open(fakeBrowser()).context(VIEWER);
    expect(
      (await contracts.openDocument('never-stored'))._unsafeUnwrapErr()
    ).toEqual({ kind: 'missing' });
  });
});

describe('signing', () => {
  it('lets the invited signer sign from another tab, and the sender sees it', async () => {
    const browser = fakeBrowser();
    const workspace = open(browser).context(VIEWER);
    const sent = await sendAcme(workspace);
    const token = findRecipient(sent, SARAH)?.access?.token ?? '';

    const signing = open(browser).signing(() => token);
    const session = signing.session();
    expect(session.t === 'ready' && session.recipient.name).toBe('Sarah Chen');

    browser.setNow('2026-11-10T19:26:47.000Z');
    (
      await signing.sign({
        ...TYPED_SIGNATURE,
        values: { 'sarah-title': 'VP, Operations' },
      })
    )._unsafeUnwrap();

    const updated = workspace.packets()[0];
    expect(packetStatus(updated, workspace.now())).toBe('partially_signed');
    expect(findRecipient(updated, SARAH)?.signedAt).toBe(
      '2026-11-10T19:26:47.000Z'
    );
    // A used link no longer opens the packet.
    expect(signing.session()).toEqual({ t: 'unavailable' });
  });

  it('does not open a packet for an unknown token', () => {
    const signing = open(fakeBrowser()).signing(() => 'not-a-token');
    expect(signing.session()).toEqual({ t: 'unavailable' });
  });

  it('closes the link once the signing window has passed', async () => {
    const browser = fakeBrowser();
    const sent = await sendAcme(open(browser).context(VIEWER));
    const token = findRecipient(sent, SARAH)?.access?.token ?? '';

    browser.setNow('2026-12-20T00:00:00.000Z');
    const signing = open(browser).signing(() => token);
    expect(signing.session()).toEqual({ t: 'unavailable' });
  });
});
