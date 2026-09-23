import { describe, expect, it } from 'vitest';
import {
  normalizeSearchParams,
  parseSearchState,
  parseSplitSearch,
  replaceSplitSearchParams,
  updateSearchState,
} from '../search';
import type { SplitLocation } from '../types';

describe('split search state', () => {
  it.each(['toString', 'valueOf', 'hasOwnProperty'])(
    'treats %s as an own search key without mutating Object.prototype functions',
    (name) => {
      const inherited = Object.getOwnPropertyDescriptor(
        Object.prototype,
        name
      )!.value;
      const before = Object.getOwnPropertyDescriptors(inherited);
      const query = new URLSearchParams([
        [`s0.${name}.target`, 'one'],
        [`s0.${name}.target`, 'two'],
        [`s0.drive.${name}`, 'value'],
      ]);
      const parsed = parseSplitSearch(query.toString());
      expect(parsed.get(0)).toEqual({
        [name]: { target: ['one', 'two'] },
        drive: { [name]: ['value'] },
      });
      expect(Object.getOwnPropertyDescriptors(inherited)).toEqual(before);
      const roundtrip = new URLSearchParams();
      replaceSplitSearchParams(roundtrip, [
        { location: { search: parsed.get(0) } },
      ]);
      expect(parseSplitSearch(roundtrip.toString())).toEqual(parsed);
      const route: SplitLocation['route'] = {
        matches: [{ id: 'drive', params: {} }],
      };
      updateSearchState(
        { route, search: {} },
        {
          [name]: (current) => {
            expect(current).toBeUndefined();
            return { target: ['value'] };
          },
        }
      );
    }
  );
  it('round trips repeated values and removes stale namespaced query keys', () => {
    const query = new URLSearchParams('referral_code=ref&s9.old.value=stale');
    const search = { drive: { tags: ['one', 'two'], sort: ['name'] } };
    replaceSplitSearchParams(query, [{ location: { search } }]);

    expect(query.get('referral_code')).toBe('ref');
    expect(query.has('s9.old.value')).toBe(false);
    expect(query.getAll('s0.drive.tags')).toEqual(['one', 'two']);
    expect(parseSplitSearch(query.toString())).toEqual(new Map([[0, search]]));
  });

  it('ignores unsafe names and oversized inbound values', () => {
    const query = new URLSearchParams({
      's0.constructor.value': 'unsafe',
      's0.drive.prototype': 'unsafe',
      's0.drive.large': 'x'.repeat(16_385),
      's0.drive.valid': 'ok',
    });
    expect(parseSplitSearch(query.toString())).toEqual(
      new Map([[0, { drive: { valid: ['ok'] } }]])
    );
    expect(() => normalizeSearchParams({ constructor: ['unsafe'] })).toThrow(
      'Invalid split search field'
    );
  });

  it('recovers only safe array-valued fields from persisted metadata', () => {
    expect(
      parseSearchState({
        drive: {
          tags: ['one', 42, 'two'],
          bad: 'scalar',
          prototype: ['unsafe'],
          huge: ['x'.repeat(16_385)],
        },
        constructor: { field: ['unsafe'] },
        other: { ok: ['value'] },
      })
    ).toEqual({ drive: { tags: ['one', 'two'] }, other: { ok: ['value'] } });
    expect(parseSearchState(null)).toBeUndefined();
    expect(parseSearchState({ drive: [] })).toBeUndefined();
  });

  it('updates namespaces without changing routes or sibling search', () => {
    const location: SplitLocation = {
      route: { matches: [{ id: 'drive', params: {} }] },
      search: { drive: { tags: ['one'] }, sidebar: { view: ['tree'] } },
    };
    let calls = 0;
    const next = updateSearchState(location, {
      drive: (current) => {
        calls += 1;
        return { tags: [...(current?.tags ?? []), 'two'] };
      },
    });
    expect(calls).toBe(1);
    expect(next.route).toBe(location.route);
    expect(next.search).toEqual({
      drive: { tags: ['one', 'two'] },
      sidebar: { view: ['tree'] },
    });
    expect(location.search?.drive.tags).toEqual(['one']);
    expect(updateSearchState(next, { drive: undefined }).search).toEqual({
      sidebar: { view: ['tree'] },
    });
    const cleared = updateSearchState(next, {
      drive: undefined,
      sidebar: undefined,
    });
    expect(cleared).toEqual({ route: location.route });
    expect(cleared.route).toBe(location.route);
  });
});
