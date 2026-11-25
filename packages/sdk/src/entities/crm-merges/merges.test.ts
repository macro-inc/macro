import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { Company } from '../crm/company';
import { Contact } from '../crm/contact';
import { CrmMergeNamespace } from './merges';

const SURVIVOR = '0192d1a0-0000-7000-8000-000000000001';
const SOURCE = '0192d1a0-0000-7000-8000-000000000002';
const REVISION =
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

function recording() {
  const bodies: Array<Record<string, unknown>> = [];
  const contactReads: string[] = [];
  let merged = false;
  const client = {
    storage: {
      getContact: async ({ path }: { path: { contact_id: string } }) => {
        contactReads.push(path.contact_id);
        return {
          data: {
            id: path.contact_id,
            emails: merged
              ? ['pat@acme.example.com', 'pat@home.example.com']
              : ['pat@acme.example.com'],
          },
        };
      },
      previewCrmMerge: async ({ body }: { body: Record<string, unknown> }) => {
        bodies.push(body);
        return { data: { revision: REVISION } };
      },
      commitCrmMerge: async ({ body }: { body: Record<string, unknown> }) => {
        bodies.push(body);
        merged = true;
        return { data: { mergeId: 'merge-1' } };
      },
    },
  } as unknown as MacroClient;
  return {
    bodies,
    client,
    contactReads,
    merges: new CrmMergeNamespace(client),
  };
}

describe('crm merges', () => {
  test('commits one review under one request key, so a retry returns its first result', async () => {
    const { bodies, client, merges } = recording();
    const commit = {
      survivor: Company.byId(client, SURVIVOR),
      sources: [Company.byId(client, SOURCE)],
      revision: REVISION,
    };

    await merges.mergeCompanies(commit);
    await merges.mergeCompanies(commit);

    expect(bodies[0]?.requestKey).toBe('9f86d081-884c-7d65-9a2f-eaa0c55ad015');
    expect(bodies[1]?.requestKey).toBe(bodies[0]?.requestKey);
  });

  test('keeps a request key the caller names', async () => {
    const { bodies, client, merges } = recording();
    const requestKey = '0192d1a0-0000-7000-8000-0000000000ff';

    await merges.mergeCompanies({
      survivor: Company.byId(client, SURVIVOR),
      sources: [Company.byId(client, SOURCE)],
      revision: REVISION,
      requestKey,
    });

    expect(bodies[0]?.requestKey).toBe(requestKey);
  });

  test('reviews and merges people as contacts', async () => {
    const { bodies, client, merges } = recording();
    const survivor = Contact.byId(client, SURVIVOR);
    const sources = [Contact.byId(client, SOURCE)];

    await merges.previewContacts({ survivor, sources });
    await merges.mergeContacts({
      survivor,
      sources,
      revision: REVISION,
      sharingRules: 'stop',
    });

    expect(bodies[0]).toEqual({
      recordType: 'contact',
      survivorId: SURVIVOR,
      sourceIds: [SOURCE],
    });
    expect(bodies[1]).toMatchObject({
      recordType: 'contact',
      survivorId: SURVIVOR,
      sourceIds: [SOURCE],
      revision: REVISION,
      requestKey: '9f86d081-884c-7d65-9a2f-eaa0c55ad015',
      sharingRules: 'stop',
    });
  });

  test('a merge drops what the merged handles loaded, so they read the merged contact', async () => {
    const { client, contactReads, merges } = recording();
    const survivor = Contact.byId(client, SURVIVOR);

    expect(await survivor.emails()).toEqual(['pat@acme.example.com']);
    await merges.mergeContacts({
      survivor,
      sources: [Contact.byId(client, SOURCE)],
      revision: REVISION,
    });

    expect(await survivor.emails()).toEqual([
      'pat@acme.example.com',
      'pat@home.example.com',
    ]);
    expect(contactReads).toEqual([SURVIVOR, SURVIVOR]);
  });
});
