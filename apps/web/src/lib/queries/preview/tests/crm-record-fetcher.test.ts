import { err, ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const previewCrmRecords = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { previewCrmRecords },
}));
vi.mock('@core/constant/allBlocks', () => ({ itemToSafeName: () => '' }));
vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('../../client', () => ({ queryClient: {} }));
vi.mock('../../agent-session/mention-fetchers', () => ({
  fetchAgentSessionMentionPreviews: vi.fn(),
}));

import { fetchRestPreviewBatch } from '../fetchers';

const COMPANY = '019a0000-0000-7000-8000-000000000001';
const CONTACT = '019a0000-0000-7000-8000-000000000011';
const DENIED = '019a0000-0000-7000-8000-000000000012';

it('titles a batch of companies and contacts with one request', async () => {
  previewCrmRecords.mockResolvedValueOnce(
    ok({
      companies: [
        {
          id: COMPANY,
          name: 'Acme',
          primaryDomain: 'acme.test',
          updatedAt: '2026-10-01',
        },
      ],
      contacts: [
        {
          id: CONTACT,
          name: 'Alex Morgan',
          email: 'alex@example.test',
          updatedAt: '2026-10-01',
        },
      ],
    })
  );
  const batch = await fetchRestPreviewBatch([
    { type: 'crm_company', id: COMPANY },
    { type: 'crm_contact', id: CONTACT },
    { type: 'crm_contact', id: DENIED },
  ]);

  expect(previewCrmRecords).toHaveBeenCalledTimes(1);
  expect(previewCrmRecords).toHaveBeenCalledWith({
    companyIds: [COMPANY],
    contactIds: [CONTACT, DENIED],
  });
  expect(batch.previews.get(COMPANY)).toMatchObject({
    access: 'access',
    name: 'Acme',
    type: 'crm_company',
  });
  expect(batch.previews.get(CONTACT)).toMatchObject({
    access: 'access',
    name: 'Alex Morgan',
    type: 'crm_contact',
  });
  expect(batch.previews.get(DENIED)).toEqual({
    id: DENIED,
    type: 'crm_contact',
    access: 'no_access',
    loading: false,
  });
});

it('sends no CRM request for a batch without CRM records', async () => {
  previewCrmRecords.mockClear();
  await fetchRestPreviewBatch([]);
  expect(previewCrmRecords).not.toHaveBeenCalled();
});

it('leaves the records of a failed request unanswered, with its errors', async () => {
  const errors = [{ code: 'HTTP_ERROR', message: 'unavailable' }];
  previewCrmRecords.mockResolvedValueOnce(err(errors));
  const batch = await fetchRestPreviewBatch([
    { type: 'crm_contact', id: CONTACT },
  ]);
  expect(batch.previews.has(CONTACT)).toBe(false);
  expect(batch.failed.get(CONTACT)).toEqual(errors);
});
