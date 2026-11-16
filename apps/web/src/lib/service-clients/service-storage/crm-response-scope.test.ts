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
      await expect(
        crmResponseScope('storage', path, `http://localhost${path}`, { method })
      ).resolves.toEqual({ protected: protectedContent, write });
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
      const request = new Request('http://localhost/graphql', {
        method: 'POST',
        body: JSON.stringify({ query, operationName }),
      });
      await expect(
        crmResponseScope('storage', '/graphql', request, {})
      ).resolves.toEqual({ protected: protectedContent, write });
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
      await expect(
        crmResponseScope('storage', '/graphql', 'http://localhost/graphql', {
          method: 'POST',
          body,
        })
      ).resolves.toEqual({ protected: true, write: false });
    }
  );

  it('retains proof for POST email reads and preserves actual email writes', async () => {
    await expect(
      crmResponseScope(
        'email',
        '/email/messages/batch',
        'http://localhost/email/messages/batch',
        { method: 'POST' }
      )
    ).resolves.toEqual({ protected: true, write: false });
    await expect(
      crmResponseScope(
        'email',
        '/email/drafts',
        'http://localhost/email/drafts',
        { method: 'POST' }
      )
    ).resolves.toEqual({ protected: true, write: true });
  });
});
