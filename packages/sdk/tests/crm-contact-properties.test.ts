import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a contact sets, reads and clears properties as CONTACT', async () => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      const path = new URL(request.url).pathname;
      const text = request.method === 'GET' ? '' : await request.text();
      requests.push({
        method: request.method,
        path,
        body: text ? JSON.parse(text) : undefined,
      });
      if (request.method === 'PUT') return new Response(null, { status: 204 });
      return Response.json({ entity_id: 'contact-1', properties: [] });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'token',
    hosts: { properties: 'https://properties.test' },
  });
  const contact = macro.crm.contactById('contact-1');
  const phone = macro.properties.definition('phone-1');

  await contact.setProperty(phone, { type: 'string', value: '+1 555 0100' });
  await contact.setProperty(phone);
  expect(await contact.properties()).toEqual([]);
  expect(contact.propertyReference()).toEqual({
    entity_type: 'CONTACT',
    entity_id: 'contact-1',
  });
  expect(requests).toEqual([
    {
      method: 'PUT',
      path: '/properties/entities/CONTACT/contact-1/phone-1',
      body: { value: { type: 'string', value: '+1 555 0100' } },
    },
    {
      method: 'PUT',
      path: '/properties/entities/CONTACT/contact-1/phone-1',
      body: { value: null },
    },
    {
      method: 'GET',
      path: '/properties/entities/CONTACT/contact-1',
      body: undefined,
    },
  ]);
});
