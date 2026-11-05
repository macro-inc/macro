import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('contact field edits use handles, explicit clears and invalidate detail only after success', async () => {
  const writes: { path: string; body: unknown }[] = [];
  let email: string | null = 'first@example.com';
  let companyId: string | null = 'company-1';
  let reject = false;
  let reads = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      const path = new URL(request.url).pathname;
      if (request.method === 'PUT') {
        const body = await request.json();
        writes.push({ path, body });
        if (reject)
          return Response.json({ message: 'conflict' }, { status: 409 });
        if (path.endsWith('/email')) email = body.email;
        if (path.endsWith('/company')) companyId = body.companyId;
      } else {
        reads++;
      }
      return Response.json({
        id: 'contact-1',
        name: 'Example person',
        email,
        companyId,
        hidden: false,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
        firstInteraction: '2026-10-01T00:00:00Z',
        lastInteraction: '2026-10-01T00:00:00Z',
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { storage: 'https://storage.test' },
  });
  const contact = macro.crm.contactById('contact-1');
  expect(await contact.email()).toBe('first@example.com');
  await contact.setEmail('second@example.com');
  expect(await contact.email()).toBe('second@example.com');
  await contact.setEmail();
  expect(await contact.email()).toBeUndefined();
  await contact.setCompany(macro.crm.companyById('company-2'));
  expect((await contact.company())?.id).toBe('company-2');
  await contact.setCompany();
  expect(await contact.company()).toBeUndefined();
  expect(writes).toEqual([
    {
      path: '/crm/contacts/contact-1/email',
      body: { email: 'second@example.com' },
    },
    { path: '/crm/contacts/contact-1/email', body: { email: null } },
    {
      path: '/crm/contacts/contact-1/company',
      body: { companyId: 'company-2' },
    },
    { path: '/crm/contacts/contact-1/company', body: { companyId: null } },
  ]);
  const readsBeforeFailure = reads;
  reject = true;
  await expect(contact.setEmail('third@example.com')).rejects.toThrow();
  expect(await contact.email()).toBeUndefined();
  expect(reads).toBe(readsBeforeFailure);
});
