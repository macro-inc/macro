import { afterEach, expect, test } from 'bun:test';
import { type EntityAppearance, Macro } from '../src/macro';
import { MacroApiError } from '../src/utils';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const cases = [
  {
    name: 'document',
    path: '/documents/appearance-test',
    entity: (macro: Macro) => macro.documents.byId('appearance-test'),
    detail: (appearance: EntityAppearance) => ({
      data: { documentMetadata: { appearance } },
    }),
  },
  {
    name: 'initiative',
    path: '/initiatives/appearance-test',
    entity: (macro: Macro) => macro.initiatives.byId('appearance-test'),
    detail: (appearance: EntityAppearance) => ({ appearance }),
  },
  {
    name: 'form',
    path: '/forms/appearance-test',
    entity: (macro: Macro) => macro.forms.byId('appearance-test'),
    detail: (appearance: EntityAppearance) => ({ form: { appearance } }),
  },
  {
    name: 'database',
    path: '/databases/appearance-test',
    entity: (macro: Macro) => macro.databases.byId('appearance-test'),
    detail: (appearance: EntityAppearance) => ({ database: { appearance } }),
  },
  {
    name: 'routine',
    path: '/scheduled-actions/appearance-test',
    entity: (macro: Macro) => macro.routines.byId('appearance-test'),
    detail: (appearance: EntityAppearance) => ({ appearance }),
  },
];

for (const entry of cases) {
  test(`${entry.name} appearance writes retain cached reads after failure and invalidate after success`, async () => {
    let saved: EntityAppearance = {};
    let refuse = false;
    let reads = 0;
    const writes: Request[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        if (request.method === 'GET') {
          reads++;
          return Response.json(entry.detail(saved));
        }
        writes.push(request.clone());
        if (refuse)
          return Response.json({ error: 'forbidden' }, { status: 403 });
        saved = await request.json();
        return Response.json(saved);
      },
      { preconnect: originalFetch.preconnect },
    );
    const entity = entry.entity(
      new Macro({
        token: 'test-token',
        hosts: {
          storage: 'https://appearance.example.test',
          'scheduled-action': 'https://appearance.example.test',
        },
      }),
    );
    const appearance: EntityAppearance = {
      icon: { kind: 'emoji', value: '🌱' },
      color: 'green',
    };

    expect(await entity.appearance()).toEqual({});
    refuse = true;
    await expect(entity.setAppearance(appearance)).rejects.toBeInstanceOf(
      MacroApiError,
    );
    expect(await entity.appearance()).toEqual({});
    expect(reads).toBe(1);

    refuse = false;
    expect(await entity.setAppearance(appearance)).toEqual(appearance);
    expect(await entity.appearance()).toEqual(appearance);
    expect(reads).toBe(2);
    await entity.setAppearance({});
    expect(await entity.appearance()).toEqual({});
    expect(reads).toBe(3);

    expect(writes).toHaveLength(3);
    for (const request of writes) {
      expect(request.method).toBe('PUT');
      expect(new URL(request.url).pathname).toBe(`${entry.path}/appearance`);
      expect(request.headers.get('authorization')).toBe('Bearer test-token');
    }
    expect(await writes[1].json()).toEqual(appearance);
    expect(await writes[2].json()).toEqual({});
  });
}
