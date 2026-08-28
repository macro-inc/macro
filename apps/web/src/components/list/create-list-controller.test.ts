import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createListController } from './create-list-controller';

type Item = { id: string; label: string; structural?: boolean };

const item = (id: string, label = id, structural = false): Item => ({
  id,
  label,
  structural,
});

const withRoot = (run: () => void) =>
  createRoot((dispose) => {
    try {
      run();
    } finally {
      dispose();
    }
  });

describe('createListController', () => {
  it('derives focused and selected payloads from replacement items', () => {
    withRoot(() => {
      const [items, setItems] = createSignal<readonly Item[]>([
        item('a', 'old'),
        item('b'),
      ]);
      const list = createListController({
        items,
        getKey: (value: Item) => value.id,
      });

      list.focus.set('a');
      list.selection.select('a');
      setItems([item('a', 'new'), item('b')]);

      expect(list.focus.item()?.label).toBe('new');
      expect(list.selection.items().map((value) => value.label)).toEqual([
        'new',
      ]);
    });
  });

  it('retains unavailable anchors until explicit pruning', () => {
    withRoot(() => {
      const [items, setItems] = createSignal<readonly Item[]>([item('a')]);
      const list = createListController({
        items,
        getKey: (value: Item) => value.id,
      });

      list.focus.set('a');
      list.selection.select('a');
      setItems([]);

      expect(list.focus.requestedKey()).toBe('a');
      expect(list.focus.key()).toBeUndefined();
      expect([...list.selection.requestedKeys()]).toEqual(['a']);
      expect([...list.selection.keys()]).toEqual([]);
      expect([...list.selection.missingKeys()]).toEqual(['a']);

      list.focus.prune();
      list.selection.prune();
      expect(list.focus.requestedKey()).toBeUndefined();
      expect(list.selection.count()).toBe(0);
    });
  });

  it('skips structural rows and wraps only when requested', () => {
    withRoot(() => {
      const values = [item('header', 'Header', true), item('a'), item('b')];
      const list = createListController({
        items: () => values,
        getKey: (value: Item) => value.id,
        isNavigable: (value) => !value.structural,
        wrapNavigation: true,
      });

      expect(list.navigate.down()?.key).toBe('a');
      expect(list.navigate.down()?.key).toBe('b');
      expect(list.navigate.down()?.key).toBe('a');
      expect(list.navigate.up()?.key).toBe('b');
    });
  });

  it('selects ranges using only selectable items', () => {
    withRoot(() => {
      const values = [item('a'), item('header', 'Header', true), item('b')];
      const list = createListController({
        items: () => values,
        getKey: (value: Item) => value.id,
        isSelectable: (value) => !value.structural,
      });

      list.selection.selectRange('a', 'b');
      expect([...list.selection.keys()].sort()).toEqual(['a', 'b']);
      list.selection.selectRange('a', 'b', false);
      expect(list.selection.count()).toBe(0);
    });
  });

  it('selects logical items independently from rendered occurrences', () => {
    withRoot(() => {
      const [items, setItems] = createSignal<readonly Item[]>([
        item('first', 'shared'),
        item('second', 'shared'),
        item('other'),
      ]);
      const list = createListController({
        items,
        getKey: (value) => value.id,
        selection: { getKey: (value) => value.label },
      });

      list.selection.select('first');
      expect([...list.selection.keys()]).toEqual(['shared']);
      expect(list.selection.isSelected('first')).toBe(true);
      expect(list.selection.isSelected('second')).toBe(true);
      expect(list.selection.items().map((value) => value.id)).toEqual([
        'first',
      ]);

      setItems([item('second', 'shared'), item('other')]);
      expect([...list.selection.keys()]).toEqual(['shared']);
      expect(list.selection.items().map((value) => value.id)).toEqual([
        'second',
      ]);
    });
  });

  it('supports command-specific navigation predicates and wrapping', () => {
    withRoot(() => {
      const values = [item('a'), item('b'), item('c')];
      const list = createListController({
        items: () => values,
        getKey: (value) => value.id,
        wrapNavigation: true,
      });

      list.focus.set('a');
      expect(
        list.navigate.by(1, {
          isNavigable: (value) => value.id !== 'b',
        })?.key
      ).toBe('c');
      expect(list.navigate.by(1, { wrap: false })).toBeUndefined();
      expect(list.navigate.by(1, { wrap: true })?.key).toBe('a');
    });
  });

  it('toggles all currently visible logical selections', () => {
    withRoot(() => {
      const values = [
        item('first', 'shared'),
        item('second', 'shared'),
        item('header', 'Header', true),
        item('other'),
      ];
      const list = createListController({
        items: () => values,
        getKey: (value) => value.id,
        selection: { getKey: (value) => value.label },
        isSelectable: (value) => !value.structural,
      });

      list.selection.toggleAllVisible();
      expect([...list.selection.keys()]).toEqual(['shared', 'other']);
      expect(list.selection.allVisibleSelected()).toBe(true);

      list.selection.toggleAllVisible();
      expect(list.selection.count()).toBe(0);
    });
  });

  it('emits typed activation metadata and focuses keyed activation', () => {
    withRoot(() => {
      const onActivate = vi.fn();
      const list = createListController<Item, { source: string }>({
        items: () => [item('a')],
        getKey: (value) => value.id,
        onActivate,
      });

      const activation = list.activate.key('a', {
        reason: 'pointer',
        metadata: { source: 'row' },
      });

      expect(activation).toMatchObject({
        key: 'a',
        reason: 'pointer',
        metadata: { source: 'row' },
      });
      expect(list.focus.key()).toBe('a');
      expect(onActivate).toHaveBeenCalledOnce();
    });
  });

  it('keeps restored anchors ineffective until eligible payloads arrive', () => {
    withRoot(() => {
      const [items, setItems] = createSignal<readonly Item[]>([]);
      const list = createListController({
        items,
        getKey: (value: Item) => value.id,
        isNavigable: (value) => !value.structural,
        isSelectable: (value) => !value.structural,
        initialSelectedKeys: ['restored'],
      });
      list.focus.restore('restored');

      setItems([item('restored', 'Header', true)]);
      expect(list.focus.requestedKey()).toBe('restored');
      expect(list.focus.key()).toBeUndefined();
      expect([...list.selection.requestedKeys()]).toEqual(['restored']);
      expect(list.selection.keys().size).toBe(0);
      expect(list.selection.items()).toEqual([]);

      setItems([item('restored')]);
      expect(list.focus.key()).toBe('restored');
      expect([...list.selection.keys()]).toEqual(['restored']);
    });
  });

  it('supports falsy generic items and rejects invalid navigation offsets', () => {
    withRoot(() => {
      const list = createListController({
        items: () => [0, 1],
        getKey: (value: number) => String(value),
      });

      expect(list.items.result('0')).toEqual({ item: 0, index: 0, key: '0' });
      expect(() => list.navigate.by(Number.POSITIVE_INFINITY)).toThrow(
        'List navigation offset must be a finite integer'
      );
      expect(() => list.navigate.by(1.5)).toThrow(
        'List navigation offset must be a finite integer'
      );
    });
  });

  it('rejects duplicate collection keys', () => {
    withRoot(() => {
      expect(() =>
        createListController({
          items: () => [item('duplicate'), item('duplicate')],
          getKey: (value: Item) => value.id,
        })
      ).toThrow('List items must have unique keys; received: duplicate');
    });
  });
});
