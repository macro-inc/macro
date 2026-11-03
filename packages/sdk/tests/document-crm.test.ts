import { afterEach, expect, test } from 'bun:test';
import { Document } from '../src/entities/documents/document';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('attaching a file uses an atomic append and leaves classification and access untouched', async () => {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return new Response(null, { status: 204 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'test-token',
    hosts: { properties: 'https://properties.example.test' },
  });
  const document = macro.documents.byId('source');
  await document.attachTo(macro.crm.companyById('company'));
  await document.attachTo(macro.crm.contactById('contact'));
  expect(requests).toHaveLength(2);
  for (const [index, kind] of ['COMPANY', 'CONTACT'].entries()) {
    expect(requests[index].method).toBe('POST');
    expect(new URL(requests[index].url).pathname).toBe(
      `/properties/entities/DOCUMENT/source/00000001-0000-0000-0000-0000000000${index === 0 ? '0c' : '13'}/crm-references`,
    );
    expect(await requests[index].json()).toEqual({
      value: {
        type: 'multi_entity_reference',
        references: [{ entity_id: kind.toLowerCase(), entity_type: kind }],
      },
    });
  }
});

test('source-file permission failures are surfaced without retrying', async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      return Response.json(
        { message: 'Edit access required' },
        { status: 403 },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'test-token',
    hosts: { properties: 'https://properties.example.test' },
  });
  await expect(
    macro.documents.byId('source').attachTo(macro.crm.companyById('company')),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});

test('tasks reject file attachments without sending a request, including through document handles', async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      return new Response(null, { status: 204 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'test-token',
    hosts: { properties: 'https://properties.example.test' },
  });
  const task = macro.tasks.byId('task');
  expect(task).toBeInstanceOf(Document);
  await expect(task.attachTo(macro.crm.companyById('company'))).rejects.toThrow(
    'Tasks cannot be attached as CRM files',
  );
  const document: Document = task;
  await expect(
    document.attachTo(macro.crm.contactById('contact')),
  ).rejects.toThrow('Tasks cannot be attached as CRM files');
  expect(calls).toBe(0);
});
