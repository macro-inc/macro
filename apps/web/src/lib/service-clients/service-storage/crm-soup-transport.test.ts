import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { storageServiceClient } from './client';
import {
  configureCrmAccessAuthority,
  crmAccessAuthority,
} from './crm-access-authority';
import { installCrmCacheHost } from './crm-access-cache';
import { restSoupNeedsCrmProof } from './crm-soup-scope';

vi.mock('@queries/client', () => ({
  queryPersistence: { retire: async () => {} },
  queryClient: { refetchQueries: async () => {} },
}));
const transport = vi.fn<typeof fetch>();
const body = {
  ccf: { l: { id: '00000000-0000-0000-0000-000000000000' } },
  emailView: 'spam',
};
const bodyText = JSON.stringify(body);
beforeEach(() => {
  transport.mockReset();
  vi.stubGlobal('fetch', transport);
  installCrmCacheHost(undefined);
  configureCrmAccessAuthority({
    fetchProof: async () => {
      throw new Error('Personal folders must not request CRM proof');
    },
    retire: async () => {},
  });
  crmAccessAuthority.setSession('viewer');
});
afterEach(() => {
  crmAccessAuthority.setSession(undefined);
  vi.unstubAllGlobals();
});

it('admits initial and continuation pages through the real transport without CRM proof', async () => {
  transport.mockResolvedValueOnce(
    Response.json({ items: [], next_cursor: 'next-page' })
  );
  const first = await storageServiceClient.getSoupAstItems({
    params: {},
    body,
  });
  expect(first.isOk()).toBe(true);
  expect(restSoupNeedsCrmProof(bodyText, 'next-page')).toBe(false);
  transport.mockResolvedValueOnce(
    Response.json({ items: [], next_cursor: 'last-page' })
  );
  const next = await storageServiceClient.getSoupAstItems({
    params: { cursor: 'next-page' },
    body,
  });
  expect(next.isOk()).toBe(true);
  expect(restSoupNeedsCrmProof(bodyText, 'last-page')).toBe(false);
  expect(transport).toHaveBeenCalledTimes(2);
  for (const [url, init] of transport.mock.calls) {
    expect(String(url)).toContain('/items/soup/ast');
    expect(new Headers(init?.headers).has('x-macro-crm-access-signal')).toBe(
      false
    );
  }
});

it('does not remember cursors from failed HTTP responses or JSON decoding', async () => {
  transport.mockResolvedValueOnce(
    Response.json({ items: [], next_cursor: 'failed-page' }, { status: 500 })
  );
  expect(
    (await storageServiceClient.getSoupAstItems({ params: {}, body })).isErr()
  ).toBe(true);
  const malformed = Response.json({ items: [], next_cursor: 'malformed-page' });
  malformed.json = async () => {
    throw new SyntaxError('invalid JSON');
  };
  transport.mockResolvedValueOnce(malformed);
  expect(
    (await storageServiceClient.getSoupAstItems({ params: {}, body })).isErr()
  ).toBe(true);
  expect(restSoupNeedsCrmProof(bodyText, 'failed-page')).toBe(true);
  expect(restSoupNeedsCrmProof(bodyText, 'malformed-page')).toBe(true);
});

it.each(['login', 'permission'] as const)(
  'fences a delayed body by %s changes without conflating the scopes',
  async (change) => {
    const started = Promise.withResolvers<void>();
    const decoding = Promise.withResolvers<{
      items: never[];
      next_cursor: string;
    }>();
    const response = Response.json({});
    response.json = () => {
      started.resolve();
      return decoding.promise;
    };
    transport.mockResolvedValueOnce(response);
    const result = storageServiceClient.getSoupAstItems({ params: {}, body });
    await started.promise;
    if (change === 'login') {
      crmAccessAuthority.setSession('replacement');
      crmAccessAuthority.setSession('viewer', 1);
    } else {
      configureCrmAccessAuthority({
        fetchProof: async () => '00000000-0000-4000-8000-000000000001:denied',
        retire: async () => {},
      });
      await crmAccessAuthority.refresh();
    }
    decoding.resolve({ items: [], next_cursor: `delayed-${change}` });
    expect((await result).isOk()).toBe(change === 'permission');
    expect(restSoupNeedsCrmProof(bodyText, `delayed-${change}`)).toBe(
      change === 'login'
    );
    expect(transport).toHaveBeenCalledTimes(1);
  }
);
