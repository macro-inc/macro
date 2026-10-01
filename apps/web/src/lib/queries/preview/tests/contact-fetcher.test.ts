import { err, ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const getContact = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getContact },
}));
vi.mock('@core/constant/allBlocks', () => ({ itemToSafeName: () => '' }));
vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('../../email/thread', () => ({ threadQueryOptions: vi.fn() }));
vi.mock('../../client', () => ({ queryClient: {} }));
vi.mock('../../agent-session/mention-fetchers', () => ({
  fetchAgentSessionMentionPreviews: vi.fn(),
}));

import { fetchRestPreviewBatch } from '../fetchers';

it('dispatches contact title lookup and preserves denied access', async () => {
  getContact.mockResolvedValueOnce(
    ok({
      name: 'Alex Morgan',
      email: 'alex@example.test',
      updatedAt: '2026-10-01',
    })
  );
  const visible = await fetchRestPreviewBatch([
    { type: 'crm_contact', id: 'contact-1' },
  ]);
  expect(getContact).toHaveBeenCalledWith({ contactId: 'contact-1' });
  expect(visible.get('contact-1')).toMatchObject({
    access: 'access',
    name: 'Alex Morgan',
    type: 'crm_contact',
  });
  getContact.mockResolvedValueOnce(err({ status: 404 }));
  const denied = await fetchRestPreviewBatch([
    { type: 'crm_contact', id: 'contact-2' },
  ]);
  expect(denied.get('contact-2')).toEqual({
    id: 'contact-2',
    type: 'crm_contact',
    access: 'no_access',
    loading: false,
  });
});
