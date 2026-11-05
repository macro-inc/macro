import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createPositionHolds } from './position-holds';

type Row = { id: string; sortTs?: string };

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));
const ids = (list: Row[]) => list.map(({ id }) => id);

const withHolds = (
  test: (
    holds: ReturnType<typeof createPositionHolds>,
    setScope: (scope: string) => void
  ) => void
) =>
  createRoot((dispose) => {
    const [scope, setScope] = createSignal('all');
    test(createPositionHolds({ scope }), setScope);
    dispose();
  });

describe('createPositionHolds', () => {
  it('keeps a held row after its previous neighbour when its sort moves it', () =>
    withHolds((holds) => {
      holds.hold(rows('kyle', 'sam', 'teo-1', 'teo-2'), ['sam']);

      // The draft is gone; Sam's thread now sorts by an older message.
      expect(ids(holds.apply(rows('kyle', 'teo-1', 'teo-2', 'sam')))).toEqual([
        'kyle',
        'sam',
        'teo-1',
        'teo-2',
      ]);
    }));

  it('keeps the first row above its old successor as new rows arrive', () =>
    withHolds((holds) => {
      holds.hold(rows('sam', 'teo'), ['sam']);

      expect(ids(holds.apply(rows('new', 'teo', 'sam')))).toEqual([
        'new',
        'sam',
        'teo',
      ]);
    }));

  it('falls back to the natural order once both neighbours are gone', () =>
    withHolds((holds) => {
      holds.hold(rows('kyle', 'sam', 'teo'), ['sam']);

      expect(ids(holds.apply(rows('a', 'b', 'sam')))).toEqual([
        'a',
        'b',
        'sam',
      ]);
    }));

  it('releases holds when the list scope changes', () =>
    withHolds((holds, setScope) => {
      holds.hold(rows('kyle', 'sam', 'teo'), ['sam']);
      setScope('inbox');

      expect(ids(holds.apply(rows('kyle', 'teo', 'sam')))).toEqual([
        'kyle',
        'teo',
        'sam',
      ]);
      expect(holds.sortTs('sam')).toBeUndefined();
    }));

  it('remembers the captured sort time for date grouping', () =>
    withHolds((holds) => {
      holds.hold([{ id: 'sam', sortTs: '2026-11-02T14:43:00Z' }], ['sam']);

      expect(holds.sortTs('sam')).toBe('2026-11-02T14:43:00Z');
    }));
});
