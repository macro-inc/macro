import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { fetchCrmContactPreviews } from './previews';

type GetContact = Parameters<typeof fetchCrmContactPreviews>[0];

const contact: CrmContactResponse = {
  id: 'contact-1',
  companyId: 'company-1',
  email: 'ada@acme.com',
  name: 'Ada Lovelace',
  hidden: false,
  firstInteraction: '2025-01-01T00:00:00.000Z',
  lastInteraction: '2025-01-02T00:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
};

const getContact: GetContact = async ({ contactId }) => {
  if (contactId === 'contact-1') return ok(contact);
  if (contactId === 'contact-2') {
    return ok({ ...contact, id: 'contact-2', name: null });
  }
  return err([{ code: 'NOT_FOUND', message: 'not found' }]);
};

describe('CRM contact previews', () => {
  it('names contacts, falling back to the email, and maps failures to no access', async () => {
    const previews = await fetchCrmContactPreviews(getContact, [
      'contact-1',
      'contact-2',
      'missing',
    ]);

    expect(previews).toEqual([
      expect.objectContaining({
        id: 'contact-1',
        type: 'crm_contact',
        access: 'access',
        name: 'Ada Lovelace',
      }),
      expect.objectContaining({
        id: 'contact-2',
        type: 'crm_contact',
        access: 'access',
        name: 'ada@acme.com',
      }),
      {
        id: 'missing',
        type: 'crm_contact',
        access: 'no_access',
        loading: false,
      },
    ]);
  });
});
