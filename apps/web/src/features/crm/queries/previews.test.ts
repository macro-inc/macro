import type { CrmPreviews } from '@service-storage/generated/schemas/crmPreviews';
import type { CrmPreviewsRequest } from '@service-storage/generated/schemas/crmPreviewsRequest';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import {
  canonicalRecordId,
  fetchCrmRecordPreviews,
  MAX_PREVIEW_IDS,
} from './previews';

const COMPANY_NAMED = '019a0000-0000-7000-8000-000000000001';
const COMPANY_DOMAIN = '019a0000-0000-7000-8000-000000000002';
const COMPANY_BARE = '019a0000-0000-7000-8000-000000000003';
const COMPANY_HIDDEN = '019a0000-0000-7000-8000-000000000004';
const CONTACT_NAMED = '019a0000-0000-7000-8000-000000000011';
const CONTACT_BLANK = '019a0000-0000-7000-8000-000000000012';
const CONTACT_OTHER_TEAM = '019a0000-0000-7000-8000-000000000013';

type PreviewRecords = Parameters<typeof fetchCrmRecordPreviews>[0];

const previews: CrmPreviews = {
  companies: [
    {
      id: COMPANY_NAMED,
      name: 'Acme',
      primaryDomain: 'acme.example',
      updatedAt: '2025-01-02T00:00:00.000Z',
    },
    {
      id: COMPANY_DOMAIN,
      name: null,
      primaryDomain: 'globex.example',
      updatedAt: '2025-01-03T00:00:00.000Z',
    },
    {
      id: COMPANY_BARE,
      name: null,
      primaryDomain: null,
      updatedAt: '2025-01-04T00:00:00.000Z',
    },
  ],
  contacts: [
    {
      id: CONTACT_NAMED,
      name: 'Ada Lovelace',
      email: 'ada@acme.example',
      updatedAt: '2025-01-05T00:00:00.000Z',
    },
    {
      id: CONTACT_BLANK,
      name: '  ',
      email: 'grace@globex.example',
      updatedAt: '2025-01-06T00:00:00.000Z',
    },
  ],
};

function recording(answer: Awaited<ReturnType<PreviewRecords>>) {
  const requests: CrmPreviewsRequest[] = [];
  const previewRecords: PreviewRecords = async (body) => {
    requests.push(body);
    return answer;
  };
  return { requests, previewRecords };
}

describe('CRM record previews', () => {
  it('titles companies and contacts from one request, and leaves out none', async () => {
    const { requests, previewRecords } = recording(ok(previews));

    const { previews: items, failed } = await fetchCrmRecordPreviews(
      previewRecords,
      [COMPANY_NAMED, COMPANY_DOMAIN, COMPANY_BARE, COMPANY_HIDDEN],
      [CONTACT_NAMED, CONTACT_BLANK, CONTACT_OTHER_TEAM]
    );

    expect(failed).toEqual(new Map());
    expect(requests).toEqual([
      {
        companyIds: [
          COMPANY_NAMED,
          COMPANY_DOMAIN,
          COMPANY_BARE,
          COMPANY_HIDDEN,
        ],
        contactIds: [CONTACT_NAMED, CONTACT_BLANK, CONTACT_OTHER_TEAM],
      },
    ]);
    expect(items).toEqual([
      {
        id: COMPANY_NAMED,
        type: 'crm_company',
        loading: false,
        access: 'access',
        rawName: 'Acme',
        name: 'Acme',
        updatedAt: '2025-01-02T00:00:00.000Z',
      },
      expect.objectContaining({ id: COMPANY_DOMAIN, name: 'globex.example' }),
      expect.objectContaining({ id: COMPANY_BARE, name: 'Unknown Company' }),
      {
        id: COMPANY_HIDDEN,
        type: 'crm_company',
        loading: false,
        access: 'no_access',
      },
      {
        id: CONTACT_NAMED,
        type: 'crm_contact',
        loading: false,
        access: 'access',
        rawName: 'Ada Lovelace',
        name: 'Ada Lovelace',
        updatedAt: '2025-01-05T00:00:00.000Z',
      },
      expect.objectContaining({
        id: CONTACT_BLANK,
        name: 'grace@globex.example',
      }),
      {
        id: CONTACT_OTHER_TEAM,
        type: 'crm_contact',
        loading: false,
        access: 'no_access',
      },
    ]);
  });

  it('sends nothing for an empty batch', async () => {
    const { requests, previewRecords } = recording(ok(previews));

    expect(await fetchCrmRecordPreviews(previewRecords, [], [])).toEqual({
      previews: [],
      failed: new Map(),
    });
    expect(requests).toEqual([]);
  });

  it('sends ids in each spelling the server parses, once, and answers each spelling', async () => {
    const { requests, previewRecords } = recording(ok(previews));
    const simple = COMPANY_NAMED.replaceAll('-', '').toUpperCase();
    const braced = `{${COMPANY_DOMAIN.toUpperCase()}}`;
    const urn = `urn:uuid:${CONTACT_NAMED}`;

    const { previews: items } = await fetchCrmRecordPreviews(
      previewRecords,
      [simple, COMPANY_NAMED, braced, COMPANY_NAMED.toUpperCase()],
      [urn, CONTACT_NAMED]
    );

    expect(requests).toEqual([
      {
        companyIds: [COMPANY_NAMED, COMPANY_DOMAIN],
        contactIds: [CONTACT_NAMED],
      },
    ]);
    expect(items).toEqual([
      expect.objectContaining({ id: simple, name: 'Acme' }),
      expect.objectContaining({ id: COMPANY_NAMED, name: 'Acme' }),
      expect.objectContaining({ id: braced, name: 'globex.example' }),
      expect.objectContaining({
        id: COMPANY_NAMED.toUpperCase(),
        name: 'Acme',
      }),
      expect.objectContaining({ id: urn, name: 'Ada Lovelace' }),
      expect.objectContaining({ id: CONTACT_NAMED, name: 'Ada Lovelace' }),
    ]);
  });

  it('previews an id the server would refuse as no access, without sending it', async () => {
    const { requests, previewRecords } = recording(ok(previews));

    const { previews: items } = await fetchCrmRecordPreviews(
      previewRecords,
      ['not-a-uuid', COMPANY_NAMED],
      ['']
    );

    expect(requests).toEqual([{ companyIds: [COMPANY_NAMED], contactIds: [] }]);
    expect(items).toEqual([
      {
        id: 'not-a-uuid',
        type: 'crm_company',
        loading: false,
        access: 'no_access',
      },
      expect.objectContaining({ id: COMPANY_NAMED, access: 'access' }),
      { id: '', type: 'crm_contact', loading: false, access: 'no_access' },
    ]);

    const none = recording(ok(previews));
    await fetchCrmRecordPreviews(none.previewRecords, ['not-a-uuid'], []);
    expect(none.requests).toEqual([]);
  });

  it('sends ids without an RFC version or variant, as stored ids can be', async () => {
    // Version nibble 0, variant nibble 6: Postgres stores it, `uuid`'s validate refuses it.
    const unversioned = '0065efd2-deae-0a7b-619f-ecc19ab60ec5';
    const { requests, previewRecords } = recording(
      ok({
        companies: [],
        contacts: [
          {
            id: unversioned,
            name: 'Ada Lovelace',
            email: 'ada@acme.example',
            updatedAt: '2025-01-05T00:00:00.000Z',
          },
        ],
      })
    );

    const { previews: items } = await fetchCrmRecordPreviews(
      previewRecords,
      [],
      [unversioned]
    );

    expect(requests).toEqual([{ companyIds: [], contactIds: [unversioned] }]);
    expect(items).toEqual([
      expect.objectContaining({
        id: unversioned,
        access: 'access',
        name: 'Ada Lovelace',
      }),
    ]);
  });

  it('splits a batch into requests of at most the server cap of each kind', async () => {
    const { requests, previewRecords } = recording(
      ok({ companies: [], contacts: [] })
    );
    const companies = ids(0, 250);
    const contacts = ids(1000, 120);

    await fetchCrmRecordPreviews(previewRecords, companies, contacts);

    expect(MAX_PREVIEW_IDS).toBe(100);
    expect(
      requests.map((request) => [
        request.companyIds?.length,
        request.contactIds?.length,
      ])
    ).toEqual([
      [100, 100],
      [100, 20],
      [50, 0],
    ]);
    expect(requests.flatMap((request) => request.companyIds)).toEqual(
      companies
    );
    expect(requests.flatMap((request) => request.contactIds)).toEqual(contacts);
  });

  it('leaves the chips of a failed request unanswered, with its errors', async () => {
    const errors = [{ code: 'HTTP_ERROR' as const, message: 'unavailable' }];
    const { previewRecords } = recording(err(errors));

    const result = await fetchCrmRecordPreviews(
      previewRecords,
      [COMPANY_NAMED, 'not-a-uuid'],
      [CONTACT_NAMED]
    );

    expect(result.previews).toEqual([
      {
        id: 'not-a-uuid',
        type: 'crm_company',
        loading: false,
        access: 'no_access',
      },
    ]);
    expect(result.failed).toEqual(
      new Map([
        [COMPANY_NAMED, errors],
        [CONTACT_NAMED, errors],
      ])
    );
  });

  it('answers the chips of the requests that succeeded when another fails', async () => {
    const errors = [{ code: 'HTTP_ERROR' as const, message: 'unavailable' }];
    const companies = ids(0, MAX_PREVIEW_IDS + 1);
    let sent = 0;
    const previewRecords: PreviewRecords = async (body) => {
      sent += 1;
      if (sent === 2) return err(errors);
      return ok({
        companies: (body.companyIds ?? []).map((id) => ({
          id,
          name: `Company ${id}`,
          primaryDomain: null,
          updatedAt: '2025-01-02T00:00:00.000Z',
        })),
        contacts: [],
      });
    };

    const result = await fetchCrmRecordPreviews(previewRecords, companies, []);

    expect(sent).toBe(2);
    expect(result.previews).toHaveLength(MAX_PREVIEW_IDS);
    expect(
      result.previews.every((item) => !item.loading && item.access === 'access')
    ).toBe(true);
    expect([...result.failed.keys()]).toEqual([companies[MAX_PREVIEW_IDS]]);
  });
});

describe('canonicalRecordId', () => {
  const id = '0065efd2-deae-0a7b-619f-ecc19ab60ec5';

  it.each([
    [id, id],
    [id.toUpperCase(), id],
    [id.replaceAll('-', ''), id],
    [id.replaceAll('-', '').toUpperCase(), id],
    [`{${id}}`, id],
    [`{${id.toUpperCase()}}`, id],
    [`urn:uuid:${id}`, id],
    [`urn:uuid:${id.toUpperCase()}`, id],
  ])('reads %s as the server does', (spelling, canonical) => {
    expect(canonicalRecordId(spelling)).toBe(canonical);
  });

  it.each([
    '',
    'not-a-uuid',
    `${id} `,
    `${id}0`,
    id.slice(1),
    `URN:UUID:${id}`,
    `{${id.replaceAll('-', '')}}`,
    `urn:uuid:${id.replaceAll('-', '')}`,
    `{${id}`,
    id.replace('-', ''),
    id.replace('0', 'g'),
  ])('refuses %j as the server does', (spelling) => {
    expect(canonicalRecordId(spelling)).toBeUndefined();
  });
});

/** `count` distinct record ids, numbered from `from`. */
function ids(from: number, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      `019a0000-0000-7000-8000-${(from + index).toString(16).padStart(12, '0')}`
  );
}
