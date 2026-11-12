import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('contact additions and company links invalidate detail only after success', async () => {
  const writes: { path: string; body: unknown }[] = [];
  const address = `contact@${'gmail.com'}`;
  let email: string | null = null;
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
  expect(await contact.email()).toBeUndefined();
  await contact.setEmail(address);
  expect(await contact.email()).toBe(address);
  await contact.setCompany(macro.crm.companyById('company-2'));
  expect((await contact.company())?.id).toBe('company-2');
  expect(writes).toEqual([
    {
      path: '/crm/contacts/contact-1/email',
      body: { email: address },
    },
    {
      path: '/crm/contacts/contact-1/company',
      body: { companyId: 'company-2' },
    },
  ]);
  const readsBeforeFailure = reads;
  reject = true;
  await expect(contact.setEmail('third@example.com')).rejects.toThrow();
  expect(await contact.email()).toBe(address);
  expect(reads).toBe(readsBeforeFailure);
});

test('contact addresses and the company link use their own routes', async () => {
  const writes: { method: string; path: string }[] = [];
  let emails = ['first@example.com'];
  let companyId: string | null = 'company-1';
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      const path = new URL(request.url).pathname;
      if (request.method !== 'GET') {
        writes.push({ method: request.method, path });
        const address = decodeURIComponent(path.split('/emails/')[1] ?? '');
        if (request.method === 'PUT' && address) emails = [...emails, address];
        if (request.method === 'DELETE' && address)
          emails = emails.filter((email) => email !== address);
        if (request.method === 'DELETE' && path.endsWith('/company'))
          companyId = null;
      }
      return Response.json({
        id: 'contact-1',
        name: 'Example person',
        email: emails[0] ?? null,
        emails,
        companyId,
        companyDomain: false,
        companyDomainEmails: [],
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

  await contact.addEmail('second+tag@example.com');
  expect(await contact.emails()).toEqual([
    'first@example.com',
    'second+tag@example.com',
  ]);
  await contact.removeEmail('first@example.com');
  expect(await contact.email()).toBe('second+tag@example.com');
  await contact.unlinkCompany();
  expect(await contact.company()).toBeUndefined();
  expect(await contact.companyDomain()).toBe(false);

  expect(writes).toEqual([
    {
      method: 'PUT',
      path: '/crm/contacts/contact-1/emails/second%2Btag%40example.com',
    },
    {
      method: 'DELETE',
      path: '/crm/contacts/contact-1/emails/first%40example.com',
    },
    { method: 'DELETE', path: '/crm/contacts/contact-1/company' },
  ]);
});
