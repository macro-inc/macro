import { describe, expect, it } from 'vitest';
import {
  type LiveQueryUpdate,
  parseCacheRevision,
} from '../../../graphql-cache/protocol';
import { ImmutableLiveRows, withPath } from './immutable-live-rows';

type Row = { id: string; name: string; tags?: string[]; shaped: boolean };

const update = (patch: Partial<LiveQueryUpdate>): LiveQueryUpdate => ({
  kind: 'live-query',
  revision: parseCacheRevision('1'),
  reset: false,
  upserts: [],
  patches: [],
  removed: [],
  retainedKeys: [],
  optimistic: false,
  ...patch,
});

const rows = () =>
  new ImmutableLiveRows<Row>((record, shaped) => ({
    ...(record as Omit<Row, 'shaped'>),
    shaped,
  }));

const identity = { mutationUuid: null, pending: false };

describe('ImmutableLiveRows', () => {
  it('replaces only the rows an update changes', () => {
    const live = rows();
    const first = live.apply(
      update({
        reset: true,
        keys: ['a', 'b'],
        upserts: [
          { recordKey: 'a', record: { id: 'a', name: 'A', tags: ['x'] } },
          { recordKey: 'b', record: { id: 'b', name: 'B' } },
        ],
      }),
      true
    );
    expect(first.map((row) => row.record.name)).toEqual(['A', 'B']);
    const sentTags = first[0].record.tags;

    const second = live.apply(
      update({
        patches: [
          {
            recordKey: 'b',
            fields: [{ path: ['name'], value: 'B2' }],
            identity,
          },
        ],
      }),
      true
    );
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1].record).toEqual({ id: 'b', name: 'B2', shaped: true });
    // The earlier row object is never changed in place.
    expect(first[1].record.name).toBe('B');
    expect(second[0].record.tags).toBe(sentTags);
  });

  it('keeps the same array when nothing changed', () => {
    const live = rows();
    const first = live.apply(
      update({
        reset: true,
        keys: ['a'],
        upserts: [{ recordKey: 'a', record: { id: 'a', name: 'A' } }],
      }),
      false
    );
    expect(live.apply(update({}), false)).toBe(first);
  });

  it('patches the record the host sent and shapes the result again', () => {
    const live = rows();
    live.apply(
      update({
        reset: true,
        keys: ['a'],
        upserts: [
          { recordKey: 'a', record: { id: 'a', name: 'A', tags: ['x', 'y'] } },
        ],
      }),
      false
    );
    const [row] = live.apply(
      update({
        patches: [
          {
            recordKey: 'a',
            fields: [{ path: ['tags', 1], value: 'z' }],
            identity,
          },
        ],
      }),
      false
    );
    expect(row.record).toEqual({
      id: 'a',
      name: 'A',
      tags: ['x', 'z'],
      shaped: false,
    });
    expect(row.identity).toEqual(identity);
  });

  it('removes, reorders and resets', () => {
    const live = rows();
    live.apply(
      update({
        reset: true,
        keys: ['a', 'b', 'c'],
        upserts: ['a', 'b', 'c'].map((id) => ({
          recordKey: id,
          record: { id, name: id },
        })),
      }),
      true
    );
    const kept = live.apply(update({ removed: ['b'], keys: ['c', 'a'] }), true);
    expect(kept.map((row) => row.recordKey)).toEqual(['c', 'a']);
    expect(live.has('b')).toBe(false);
    const reset = live.apply(
      update({
        reset: true,
        keys: ['d'],
        upserts: [{ recordKey: 'd', record: { id: 'd', name: 'd' } }],
      }),
      true
    );
    expect(reset.map((row) => row.recordKey)).toEqual(['d']);
    expect(live.has('a')).toBe(false);
  });

  it('refuses a patch with no base row', () => {
    expect(() =>
      rows().apply(
        update({
          patches: [
            {
              recordKey: 'a',
              fields: [{ path: ['name'], value: 'A' }],
              identity,
            },
          ],
        }),
        true
      )
    ).toThrow('live query patch has no base row');
  });

  it('keeps each row a reset resends unchanged', () => {
    const live = rows();
    const reset = (name: string) =>
      live.apply(
        update({
          reset: true,
          keys: ['a', 'b'],
          upserts: [
            { recordKey: 'a', record: { id: 'a', name: 'A', tags: ['x'] } },
            { recordKey: 'b', record: { id: 'b', name } },
          ],
        }),
        true
      );
    const first = reset('B');
    const second = reset('B2');
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1].record.name).toBe('B2');
    // A row shaped differently is rebuilt even when its record is unchanged.
    const unshaped = live.apply(
      update({
        upserts: [
          { recordKey: 'a', record: { id: 'a', name: 'A', tags: ['x'] } },
        ],
      }),
      false
    );
    expect(unshaped[0]).not.toBe(second[0]);
    expect(unshaped[0].record.shaped).toBe(false);
  });
});

describe('withPath', () => {
  it('copies only the branch it sets', () => {
    const value = { a: { b: [1, 2] }, c: { d: 1 } };
    const next = withPath(value, ['a', 'b', 0], 9) as typeof value;
    expect(next).toEqual({ a: { b: [9, 2] }, c: { d: 1 } });
    expect(next.c).toBe(value.c);
    expect(Array.isArray(next.a.b)).toBe(true);
    expect(value.a.b[0]).toBe(1);
  });

  it('replaces the whole value for an empty path', () => {
    expect(withPath({ a: 1 }, [], 2)).toBe(2);
  });
});
