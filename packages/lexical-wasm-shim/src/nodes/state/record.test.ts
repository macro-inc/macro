import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { ParagraphNode, TextNode } from '../index';
import { createState } from './config';
import { nodeStatesAreEquivalent } from './helpers';
import { stateJSONFromNodeJSON } from './json';
import { StateRecord } from './record';
import { SharedState } from './shared';

test('pure state records lazily parse unknown data and elide defaults without mutating opaque values', () => {
  const editor = createEditor({
    namespace: 'state record',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const node = new TextNode('text');
        $getRoot().append(new ParagraphNode().append(node));
        const opaque = { retained: true };
        let parses = 0;
        const count = createState('count', {
          parse(value): number {
            parses++;
            return typeof value === 'number' ? value : 0;
          },
        });
        const state = new StateRecord(node, new SharedState(), {
          count: 4,
          unknown: opaque,
        });
        expect(parses).toBe(1);
        expect(state.size).toBe(2);
        expect(state.getValue(count)).toBe(4);
        expect(state.getValue(count)).toBe(4);
        expect(parses).toBe(2);
        expect(state.getInternalState()[1].get(count)).toBe(4);
        expect(state.unknownState?.unknown).toBe(opaque);
        state.updateFromKnown(count, 0);
        expect(state.toJSON()).toEqual({ $: { unknown: opaque } });
        expect(state.size).toBe(2);
        expect(state.unknownState?.count).toBe(4);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('pure state copy-on-write retains opaque references and resets only configured known keys', () => {
  const editor = createEditor({
    namespace: 'state copy',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const first = new TextNode('first').toggleUnmergeable();
        const second = new TextNode('second').toggleUnmergeable();
        $getRoot().append(new ParagraphNode().append(first, second));
        const fallback = { value: 0 };
        const opaque = { value: 1 };
        const persistent = createState('persistent', {
          parse: (value: unknown) => (value === opaque ? opaque : fallback),
        });
        const transient = createState('transient', {
          parse: (value: unknown) => (typeof value === 'number' ? value : 0),
          resetOnCopyNode: true,
        });
        const state = new StateRecord(first, new SharedState(), {
          unknown: opaque,
        });
        state.updateFromKnown(persistent, opaque);
        state.updateFromKnown(transient, 9);
        const copy = state.getWritable(second);
        expect(state.getWritable(first)).toBe(state);
        expect(copy).not.toBe(state);
        expect(copy.node).toBe(second);
        expect(copy.getValue(persistent)).toBe(opaque);
        expect(copy.unknownState?.unknown).toBe(opaque);
        expect(nodeStatesAreEquivalent(state, copy)).toBe(true);
        copy.resetOnCopyNode();
        expect(copy.getValue(transient)).toBe(0);
        expect(state.getValue(transient)).toBe(9);
        expect(copy.getValue(persistent)).toBe(opaque);
        expect(copy.unknownState?.unknown).toBe(opaque);
        expect(nodeStatesAreEquivalent(state, copy)).toBe(false);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('state JSON uses unparse and merges flat inputs without changing the nested input bag', () => {
  const editor = createEditor({
    namespace: 'state JSON',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const node = new TextNode('text');
        $getRoot().append(new ParagraphNode().append(node));
        const date = createState('date', {
          parse: (value: unknown) =>
            typeof value === 'string' ? new Date(value) : new Date(0),
          unparse: (value) => value.toISOString(),
        });
        const shared = new SharedState([{ stateConfig: date, flat: true }]);
        const nested = { date: 'nested', untouched: { retained: true } };
        const serialized = { $: nested, date: '2000-01-01T00:00:00.000Z' };
        const merged = stateJSONFromNodeJSON(serialized, shared);
        expect(merged).not.toBe(nested);
        expect(merged).toEqual({
          date: '2000-01-01T00:00:00.000Z',
          untouched: nested.untouched,
        });
        expect(nested.date).toBe('nested');
        expect(stateJSONFromNodeJSON({ $: nested }, shared)).toBe(nested);
        const state = new StateRecord(node, shared);
        state.updateFromJSON(merged);
        expect(state.getValue(date)).toBeInstanceOf(Date);
        expect(state.toJSON()).toEqual({
          date: '2000-01-01T00:00:00.000Z',
          $: { untouched: nested.untouched },
        });
        state.updateFromJSON(undefined);
        expect(state.getValue(date)).toBe(date.defaultValue);
        expect(state.toJSON()).toEqual({});
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('known undefined values retain upstream default-read and copy behavior without erased casts', () => {
  const editor = createEditor({
    namespace: 'undefined state',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const first = new TextNode('first').toggleUnmergeable();
        const second = new TextNode('second').toggleUnmergeable();
        $getRoot().append(new ParagraphNode().append(first, second));
        const config = createState('optional', {
          parse: (): number | undefined => 0,
        });
        const state = new StateRecord(first, new SharedState());
        state.updateFromKnown(config, undefined);
        expect(state.getValue(config)).toBe(0);
        expect(state.knownState.has(config)).toBe(true);
        expect(state.knownState.get(config)).toBeUndefined();
        const next = state.getWritable(second);
        expect(next.knownState.has(config)).toBe(true);
        expect(next.knownState.get(config)).toBeUndefined();
        expect(next.getValue(config)).toBe(0);
        expect(next.size).toBe(1);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('copy-on-write parses newly shared configurations while preserving the source unknown data', () => {
  const editor = createEditor({
    namespace: 'deferred state config',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const first = new TextNode('first').toggleUnmergeable();
        const second = new TextNode('second').toggleUnmergeable();
        $getRoot().append(new ParagraphNode().append(first, second));
        const parsed: unknown[] = [];
        const config = createState('later', {
          parse(value: unknown): number {
            parsed.push(value);
            return typeof value === 'number' ? value : 0;
          },
        });
        const shared = new SharedState();
        const source = new StateRecord(first, shared, { later: 3 });
        const other = new StateRecord(second, shared);
        expect(other.getValue(config)).toBe(0);
        const copy = source.getWritable(second);
        expect(parsed).toEqual([undefined, 3]);
        expect(source.knownState.has(config)).toBe(false);
        expect(source.unknownState).toEqual({ later: 3 });
        expect(copy.getValue(config)).toBe(3);
        expect(copy.unknownState).toBeUndefined();
        expect(copy.size).toBe(1);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('state serialization preserves equality, key and unparse observation order', () => {
  const editor = createEditor({
    namespace: 'state serialization order',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const node = new TextNode('text');
        $getRoot().append(new ParagraphNode().append(node));
        const observations: string[] = [];
        const config = createState('count', {
          parse: (value: unknown) => (typeof value === 'number' ? value : 0),
          isEqual: (first, second) => {
            observations.push('equal');
            return Object.is(first, second);
          },
          unparse: (value) => {
            observations.push('unparse');
            return value;
          },
        });
        const state = new StateRecord(node, new SharedState());
        state.updateFromKnown(config, 2);
        Object.defineProperty(config, 'key', {
          get() {
            observations.push('key');
            return 'count';
          },
        });
        expect(state.toJSON()).toEqual({ $: { count: 2 } });
        expect(observations).toEqual(['equal', 'key', 'unparse']);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('knownState is a live readable Map and rejects unsupported internal mutation', () => {
  const editor = createEditor({
    namespace: 'read-only state bookkeeping',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const node = new TextNode('text');
        $getRoot().append(new ParagraphNode().append(node));
        const config = createState('count', {
          parse: (value: unknown) => (typeof value === 'number' ? value : 0),
        });
        const state = new StateRecord(node, new SharedState());
        const view = state.knownState;
        state.updateFromKnown(config, 1);
        expect(view).toBeInstanceOf(Map);
        expect(view.size).toBe(1);
        expect(view.has(config)).toBe(true);
        expect(view.get(config)).toBe(1);
        expect([...view]).toEqual([[config, 1]]);
        expect(() => view.set(config, 9)).toThrow(
          'internal field; use $setState'
        );
        expect(() => view.delete(config)).toThrow(
          'internal field; use $setState'
        );
        expect(() => view.clear()).toThrow('internal field; use $setState');
        expect(state.getValue(config)).toBe(1);
        expect(state.toJSON()).toEqual({ $: { count: 1 } });
        state.updateFromKnown(config, 2);
        expect(state.knownState).toBe(view);
        expect(view.get(config)).toBe(2);
        expect([...view.values()]).toEqual([2]);
        expect(view.size).toBe(1);
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});
