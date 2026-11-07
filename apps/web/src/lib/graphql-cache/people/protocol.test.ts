import { describe, expect, it, vi } from 'vitest';
import { isCacheRequest } from '../worker/coordinator-protocol';
import { createPeopleCache } from './host';
import {
  isPeopleContextUpdate,
  isPeopleSearch,
  type PeopleSearch,
} from './protocol';

const SCOPE = {
  identity: 'macro|viewer@example.com',
  storageGeneration: '00000000-0000-4000-8000-000000000001',
};
const SEARCH: PeopleSearch = {
  scope: SCOPE,
  query: '',
  excluded: [],
  limit: 2,
  mode: 'command',
  nowMs: 0,
};
const UPDATE = {
  scope: SCOPE,
  epoch: '00000000-0000-4000-8000-000000000002',
  action: { kind: 'commit' },
} as const;

describe('person transport admission', () => {
  it('bounds raw arrays, UTF-8 input and integer clocks before dispatch', () => {
    expect(isPeopleSearch(SEARCH)).toBe(true);
    expect(
      isPeopleSearch({
        ...SEARCH,
        excluded: Array(501).fill('macro|repeat@example.com'),
      })
    ).toBe(false);
    expect(isPeopleSearch({ ...SEARCH, query: 'é'.repeat(257) })).toBe(false);
    expect(isPeopleSearch({ ...SEARCH, query: 'é'.repeat(256) })).toBe(true);
    expect(
      isPeopleSearch({ ...SEARCH, nowMs: Number.MAX_SAFE_INTEGER + 1 })
    ).toBe(false);
    expect(isPeopleSearch({ ...SEARCH, mode: 'unknown' })).toBe(false);
    expect(isPeopleSearch({ ...SEARCH, limit: 501 })).toBe(false);
    expect(
      isPeopleSearch({
        ...SEARCH,
        scope: { ...SCOPE, storageGeneration: 'stale' },
      })
    ).toBe(false);
    expect(
      isPeopleContextUpdate({
        ...UPDATE,
        action: { kind: 'patch', updates: Array(501).fill({}) },
      })
    ).toBe(false);
    expect(
      isPeopleContextUpdate({
        ...UPDATE,
        action: { kind: 'commit', updates: [] },
      })
    ).toBe(false);
    expect(
      isPeopleContextUpdate({ ...UPDATE, scope: { identity: SCOPE.identity } })
    ).toBe(false);
  });

  it('coordinator forwards complete scope and epochs but rejects unknown fields and telemetry payloads', () => {
    expect(
      isCacheRequest({ id: 1, kind: 'people-update', update: UPDATE })
    ).toBe(true);
    expect(
      isCacheRequest({ id: 1, kind: 'people-context', scope: SCOPE })
    ).toBe(true);
    expect(
      isCacheRequest({ id: 1, kind: 'people-search', request: SEARCH })
    ).toBe(true);
    expect(
      isCacheRequest({
        id: 1,
        kind: 'people-update',
        update: { ...UPDATE, identity: 'other' },
      })
    ).toBe(false);
    expect(
      isCacheRequest({
        id: 1,
        kind: 'people-search',
        request: SEARCH,
        traceparent: 'not trace context',
      })
    ).toBe(false);
  });

  it('validates before transport and rejects malformed or oversized replies without leaking them', async () => {
    const transport = {
      context: vi
        .fn()
        .mockResolvedValue({ kind: 'ready', epoch: UPDATE.epoch }),
      search: vi.fn().mockResolvedValue({
        kind: 'page',
        people: Array(501).fill({}),
        truncated: true,
      }),
      update: vi.fn().mockResolvedValue('3'),
    };
    const cache = createPeopleCache(transport);
    await expect(cache.context(SCOPE)).resolves.toEqual({
      kind: 'ready',
      epoch: UPDATE.epoch,
    });
    await expect(cache.update(UPDATE)).resolves.toBe('3');
    await expect(cache.search({ ...SEARCH, limit: 501 })).rejects.toThrow(
      'Invalid contact search request'
    );
    expect(transport.search).not.toHaveBeenCalled();
    await expect(cache.search(SEARCH)).rejects.toThrow(
      'Invalid contact search response'
    );
    transport.search.mockRejectedValue(
      new Error('cache hydration scope changed')
    );
    await expect(cache.search(SEARCH)).rejects.toThrow(
      'cache hydration scope changed'
    );
    expect(transport.search).toHaveBeenLastCalledWith(SEARCH, undefined);
  });
});
