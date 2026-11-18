import { rememberOwnedEmail } from '@graphql-cache/authority-scope';
import { describe, expect, it } from 'vitest';
import { crmResponseScope } from './crm-response-scope';

describe('CRM response content scope', () => {
  it.each([
    ['/documents', 'POST', false, true],
    ['/documents/document-1', 'GET', false, false],
    [
      '/channels/attachments/document/document-1/references',
      'GET',
      true,
      false,
    ],
    [
      '/channels/attachments/crm_company/company-1/references',
      'GET',
      true,
      false,
    ],
    ['/messages/channel/channel-1', 'POST', false, true],
    ['/history/project/folder-1', 'POST', false, true],
    ['/history/thread/thread-1', 'POST', false, true],
    ['/history/crm_company/company-1', 'DELETE', false, true],
    ['/history', 'GET', true, false],
    ['/history/project/folder-1', 'GET', true, false],
    ['/history/project/folder-1', 'PATCH', true, true],
    ['/history/project/folder-1/details', 'POST', true, false],
    ['/reminders/email/collection', 'GET', false, false],
    [
      '/reminders/email/00000000-0000-4000-8000-000000000001',
      'GET',
      false,
      false,
    ],
    [
      '/reminders/email/00000000-0000-4000-8000-000000000001',
      'PUT',
      false,
      true,
    ],
    ['/reminders/email/collection', 'PUT', true, true],
    [
      '/reminders/email/00000000-0000-4000-8000-000000000001',
      'POST',
      true,
      false,
    ],
    [
      '/reminders/email/00000000-0000-4000-8000-000000000001/history',
      'GET',
      true,
      false,
    ],
    ['/reminders/00000000-0000-4000-8000-000000000001', 'GET', true, false],
    [
      '/messages/channel/channel-1/items/message-1/reactions',
      'POST',
      false,
      true,
    ],
    ['/collab_surfaces/surface-1', 'GET', true, false],
    ['/crm/companies', 'POST', true, true],
    ['/crm/contacts', 'POST', true, true],
    ['/crm/companies/company-1/contacts', 'POST', true, true],
    ['/crm/companies/company-1', 'PATCH', true, true],
    ['/crm/previews', 'POST', true, false],
    ['/crm/pipelines/pipeline-1/entries/find', 'POST', true, false],
    ['/databases/database-1/query', 'POST', true, false],
    [
      '/databases/database-1/tables/table-1/columns/column-1/conversion',
      'POST',
      true,
      false,
    ],
    ['/unknown', 'POST', true, false],
  ])(
    '%s %s separates outcomes from cache admission',
    async (path, method, protectedContent, write) => {
      expect(
        await crmResponseScope('storage', path, `http://localhost${path}`, {
          method,
        })
      ).toEqual({ protected: protectedContent, write });
    }
  );

  it('uses the selected GraphQL operation rather than the HTTP method', async () => {
    const query = `query Read { user { emailThread { id } } }
      mutation Write { setEntityProperty(input: {entityType: CRM_COMPANY}) { id } }
      query Document { soupEntity(input: {entityType: DOCUMENT}) { id } }`;
    for (const [operationName, protectedContent, write] of [
      ['Read', true, false],
      ['Write', true, true],
      ['Document', false, false],
    ] as const) {
      const request = new Request('http://localhost/items/soup/graphql', {
        method: 'POST',
        body: JSON.stringify({ query, operationName }),
      });
      expect(
        await crmResponseScope('storage', '/items/soup/graphql', request, {})
      ).toEqual({ protected: protectedContent, write });
      expect(request.bodyUsed).toBe(false);
    }
  });

  it.each([
    'not JSON',
    JSON.stringify({ query: 'mutation {' }),
    JSON.stringify({ query: 'query One { id } query Two { id }' }),
  ])(
    'keeps ambiguous or malformed GraphQL requests read-like',
    async (body) => {
      expect(
        await crmResponseScope(
          'storage',
          '/graphql',
          'http://localhost/graphql',
          {
            method: 'POST',
            body,
          }
        )
      ).toEqual({ protected: true, write: false });
    }
  );

  it('keeps mailbox-scoped POST reads and writes independent of CRM proof', async () => {
    expect(
      await crmResponseScope(
        'email',
        '/email/messages/batch',
        'http://localhost/email/messages/batch',
        { method: 'POST' }
      )
    ).toEqual({ protected: false, write: false });
    expect(
      await crmResponseScope(
        'email',
        '/email/drafts',
        'http://localhost/email/drafts',
        { method: 'POST' }
      )
    ).toEqual({ protected: false, write: true });
  });

  it.each([
    ['/email/settings', 'PATCH', false],
    ['/email/threads/thread/seen', 'POST', false],
    ['/email/threads/thread/messages', 'GET', false],
    ['/email/threads/thread/operations', 'GET', false],
    ['/email/threads/thread/read-receipts', 'GET', false],
    ['/email/threads/thread/state', 'PATCH', false],
    ['/email/threads/thread/project', 'PATCH', false],
    ['/email/threads/previews/cursor/inbox', 'GET', false],
    ['/email/threads/thread', 'GET', true],
    ['/email/attachments/attachment', 'GET', true],
    ['/email/attachments/attachment/document_id', 'GET', true],
    ['/email/messages/message/eml', 'GET', true],
    ['/email/unknown', 'GET', true],
  ])(
    'classifies %s by its inbox or entity grant',
    async (path, method, protectedContent) => {
      expect(
        await crmResponseScope('email', path, `http://localhost${path}`, {
          method,
        })
      ).toHaveProperty('protected', protectedContent);
    }
  );

  it('uses a current ownership witness for a thread read without opening shared threads', async () => {
    let current = true;
    const path = '/email/threads/owned-rest-thread';
    rememberOwnedEmail('owned-rest-thread', () => current);
    expect(
      await crmResponseScope('email', path, `http://localhost${path}`, {})
    ).toEqual({ protected: false, write: false });
    current = false;
    expect(
      await crmResponseScope('email', path, `http://localhost${path}`, {})
    ).toEqual({ protected: true, write: false });
  });
});
