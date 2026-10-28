import { describe, expect, it } from 'vitest';
import { changedPanes, diffPanes } from '../panes/diff';
import {
  applyHistoryChange,
  findBack,
  findStep,
  removeEntries,
} from '../panes/history';
import { createMemoryPaneStore } from '../panes/memory-store';
import { createPanes, insertionIndex } from '../panes/panes';
import type {
  PaneId,
  PanePolicy,
  PaneSnapshot,
  Placement,
} from '../panes/types';

/** Panes know nothing about routes; these entries are just titled cards. */
type Card = {
  id: string;
  title: string;
  props?: unknown;
  keepProps?: boolean;
};

const card = (id: string, title = id, extra: Partial<Card> = {}): Card => ({
  id,
  title,
  ...extra,
});
const pane = (id: string) => id as PaneId;
const sameTitle = (left: Card, right: Card) => left.title === right.title;

describe('pane history', () => {
  const snapshot: PaneSnapshot<Card> = {
    entries: [
      card('a'),
      card('b', 'b', { props: { once: true } }),
      card('c', 'c', { props: { kept: true }, keepProps: true }),
    ],
    index: 1,
  };

  it('drops one-shot props from the entry being left', () => {
    const pushed = applyHistoryChange(snapshot, {
      type: 'push',
      entry: card('d'),
    });
    expect(pushed.entries.map((item) => item.id)).toEqual(['a', 'b', 'd']);
    expect(pushed.entries[1]!.props).toBeUndefined();
    expect(pushed.index).toBe(2);

    const moved = applyHistoryChange(
      { ...snapshot, index: 2 },
      { type: 'go', index: 0, entry: snapshot.entries[0]! }
    );
    expect(moved.entries[2]!.props).toEqual({ kept: true });
  });

  it('steps over entries that cannot be visited', () => {
    const skipB = (item: Card) => item.id !== 'b';
    expect(findStep({ ...snapshot, index: 2 }, -1, skipB)?.entry.id).toBe('a');
    expect(findStep(snapshot, 1)?.entry.id).toBe('c');
    expect(findStep(snapshot, 5)).toBeUndefined();
    expect(
      findBack({ ...snapshot, index: 2 }, (item) => item.id === 'a')?.index
    ).toBe(0);
  });

  it('removes entries and keeps the cursor on the nearest survivor', () => {
    const next = removeEntries(
      { ...snapshot, index: 2 },
      (item) => item.id !== 'c'
    );
    expect(next).toEqual({ entries: [snapshot.entries[2]], index: 0 });
    expect(removeEntries(snapshot, () => true)).toBeUndefined();
  });
});

describe('panes diff', () => {
  const histories = new Map<PaneId, PaneSnapshot<Card>>([
    [pane('p1'), { entries: [card('a', 'home'), card('b', 'mail')], index: 1 }],
    [pane('p2'), { entries: [card('c', 'drive')], index: 0 }],
  ]);
  const live = {
    panes: [pane('p1'), pane('p2')],
    read: (id: PaneId) => histories.get(id),
  };
  const options = { createPaneId: () => pane('new'), same: sameTitle };

  it('keeps untouched panes and moves within history for known entries', () => {
    const diff = diffPanes(
      live,
      [
        { paneId: pane('p1'), entry: card('a', 'home') },
        { paneId: pane('p2'), entry: card('c', 'drive') },
      ],
      options
    );
    expect(diff.panes).toMatchObject([
      { kind: 'change', pane: 'p1', index: 0, to: { id: 'a' } },
      { kind: 'keep', pane: 'p2' },
    ]);
    expect(diff.removed).toEqual([]);
  });

  it('lets the caller merge a stored entry with the incoming one', () => {
    const diff = diffPanes(
      live,
      [{ paneId: pane('p1'), entry: card('a', 'home again') }],
      {
        ...options,
        adopt: (stored, incoming) => ({ ...stored, title: incoming.title }),
      }
    );
    expect(diff.panes[0]).toMatchObject({
      kind: 'change',
      index: 0,
      to: { id: 'a', title: 'home again' },
    });
  });

  it('creates, changes by position and removes panes as needed', () => {
    const created = diffPanes(
      live,
      [{ paneId: pane('p9'), entry: card('z', 'doc') }],
      options
    );
    expect(created.panes).toMatchObject([{ kind: 'create', pane: 'p9' }]);
    expect(created.removed).toEqual(['p1', 'p2']);

    const positional = diffPanes(
      live,
      [{ entry: card('x', 'doc') }, { entry: card('y', 'drive') }],
      options
    );
    expect(positional.panes).toMatchObject([
      { kind: 'change', pane: 'p1', to: { id: 'x' } },
      { kind: 'keep', pane: 'p2' },
    ]);
    expect(positional.panes[0]).not.toHaveProperty('index');
  });
});

describe('panes', () => {
  function setup(policy: Partial<PanePolicy<Card, string>> = {}) {
    const removed: PaneId[] = [];
    let created = 0;
    const panes = createPanes<Card, string>({
      store: createMemoryPaneStore<Card>(),
      policy: {
        placeNewPane: ({ panes }) => ({ insertAt: panes.length }),
        closeAction: () => ({ type: 'remove' }),
        activate: () => {},
        ...policy,
      },
      createPaneId: () => pane(`p${++created}`),
      onRemove: (id) => removed.push(id),
    });
    return { panes, removed };
  }

  it('inserts, moves and removes panes in order', () => {
    const { panes, removed } = setup();
    panes.insert(pane('a'), card('1'), 0);
    panes.insert(pane('b'), card('2'), 1);
    expect(panes.ids()).toEqual(['a', 'b']);

    expect(panes.move(pane('b'), 0)).toBe(true);
    expect(panes.ids()).toEqual(['b', 'a']);
    expect(panes.move(pane('b'), 0)).toBe(false);

    panes.remove(pane('a'));
    expect(panes.ids()).toEqual(['b']);
    expect(panes.read(pane('a'))).toBeUndefined();
    expect(removed).toEqual(['a']);
  });

  it('places a new pane after the same neighbour when panes changed meanwhile', () => {
    const [a, b, c] = ['a', 'b', 'c'] as PaneId[];
    expect(insertionIndex([a, b], 1, [a, b])).toBe(1);
    expect(insertionIndex([a, b], 1, [a, c, b])).toBe(2);
    expect(insertionIndex([a, b], 0, [c, a, b])).toBe(1);
    expect(insertionIndex([a, b], 2, [c, a, b])).toBe(3);
    expect(insertionIndex([a, b], 1, [b])).toBe(1);

    const { panes } = setup();
    panes.insert(a, card('1'), 0);
    panes.insert(b, card('2'), 1, [a]);
    panes.insert(c, card('3'), 1, [a]);
    expect(panes.ids()).toEqual(['a', 'b', 'c']);
  });

  it('records each change and how the pane arrived', () => {
    const { panes } = setup();
    panes.insert(pane('a'), card('1'), 0);
    expect(panes.arrival(pane('a'))).toBe('fresh');
    panes.commit(pane('a'), { type: 'push', entry: card('2') }, 'fresh');
    panes.commit(pane('a'), { type: 'go', index: 0, entry: card('1') }, 'back');
    expect(panes.current(pane('a'))?.id).toBe('1');
    expect(panes.arrival(pane('a'))).toBe('back');
  });

  it('applies a diff: moving through history, changing and removing panes', () => {
    const { panes, removed } = setup();
    panes.insert(pane('a'), card('1', 'home'), 0);
    panes.commit(pane('a'), { type: 'push', entry: card('2', 'mail') });
    panes.insert(pane('b'), card('3', 'drive'), 1);
    panes.insert(pane('c'), card('4', 'tasks'), 2);

    const diff = panes.diff(
      [
        { paneId: pane('a'), entry: card('1', 'home') },
        { entry: card('5', 'calendar') },
      ],
      { same: sameTitle }
    );
    panes.applyDiff(
      diff,
      changedPanes(diff).map((change) =>
        change.kind === 'change' ? change.to : change.entry
      )
    );

    expect(panes.ids()).toEqual(['a', 'b']);
    expect(panes.current(pane('a'))?.id).toBe('1');
    expect(panes.arrival(pane('a'))).toBe('back');
    expect(panes.current(pane('b'))?.id).toBe('5');
    expect(panes.arrival(pane('b'))).toBe('fresh');
    expect(removed).toEqual(['c']);
  });

  it('asks the policy with the panes as they are now', () => {
    const requests: unknown[] = [];
    const { panes } = setup({
      placeNewPane: (request): Placement => {
        requests.push(request);
        return { pane: pane('a') };
      },
      closeAction: (request) => {
        requests.push(request);
        return { type: 'keep' };
      },
    });
    panes.insert(pane('a'), card('1'), 0);
    expect(panes.placeNewPane({ destination: 'doc' })).toEqual({
      pane: 'a',
    });
    expect(panes.closeAction(pane('a'))).toEqual({ type: 'keep' });
    expect(requests).toEqual([
      {
        destination: 'doc',
        intent: {},
        allowDuplicate: false,
        opening: 0,
        panes: ['a'],
      },
      { pane: 'a', panes: ['a'] },
    ]);
  });
});
