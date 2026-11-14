import type { CrmPreviews } from '@service-storage/generated/schemas/crmPreviews';
import type { CrmPreviewsRequest } from '@service-storage/generated/schemas/crmPreviewsRequest';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { fetchCrmRecordPreviews } from './previews';

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

    const items = await fetchCrmRecordPreviews(
      previewRecords,
      [COMPANY_NAMED, COMPANY_DOMAIN, COMPANY_BARE, COMPANY_HIDDEN],
      [CONTACT_NAMED, CONTACT_BLANK, CONTACT_OTHER_TEAM]
    );

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

    expect(await fetchCrmRecordPreviews(previewRecords, [], [])).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('leaves ids that are not UUIDs out of the request, and matches ids in any case', async () => {
    const { requests, previewRecords } = recording(ok(previews));

    const items = await fetchCrmRecordPreviews(
      previewRecords,
      ['not-a-uuid', COMPANY_NAMED.toUpperCase()],
      ['']
    );

    expect(requests).toEqual([
      { companyIds: [COMPANY_NAMED.toUpperCase()], contactIds: [] },
    ]);
    expect(items).toEqual([
      {
        id: 'not-a-uuid',
        type: 'crm_company',
        loading: false,
        access: 'no_access',
      },
      expect.objectContaining({
        id: COMPANY_NAMED.toUpperCase(),
        access: 'access',
        name: 'Acme',
      }),
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

    const items = await fetchCrmRecordPreviews(
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

  it('reads a failed batch as no access to each record', async () => {
    const { previewRecords } = recording(
      err([{ code: 'HTTP_ERROR', message: 'unavailable' }])
    );

    const items = await fetchCrmRecordPreviews(
      previewRecords,
      [COMPANY_NAMED],
      [CONTACT_NAMED]
    );

    expect(items).toEqual([
      {
        id: COMPANY_NAMED,
        type: 'crm_company',
        loading: false,
        access: 'no_access',
      },
      {
        id: CONTACT_NAMED,
        type: 'crm_contact',
        loading: false,
        access: 'no_access',
      },
    ]);
  });
});
