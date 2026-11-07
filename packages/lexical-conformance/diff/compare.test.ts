import { expect, test } from 'vitest';
import type { Snapshot } from './commands';
import { Comparison } from './compare';

const initial: Snapshot = {
  state: { root: { children: [{ type: 'paragraph', children: [] }] } },
  selection: null,
  text: '',
  error: null,
  commit: null,
  keys: [
    { path: [], key: 'root' },
    { path: [0], key: '1' },
  ],
};

test('matching destruction and recreation cannot hide key reuse', () => {
  const comparison = new Comparison();
  comparison.compare(initial, initial);
  const removed: Snapshot = {
    ...initial,
    state: { root: { children: [] } },
    keys: [{ path: [], key: 'root' }],
    commit: {
      dirtyLeaves: [],
      dirtyElements: [['root', true]],
      normalized: [],
      mutations: [['1', 'destroyed']],
      tags: [],
    },
  };
  comparison.compare(removed, removed);
  expect(() => comparison.compare(initial, initial)).toThrow(
    'identity lifecycle'
  );
});

test('matching reuse of a normalized transient identity fails', () => {
  const comparison = new Comparison();
  comparison.compare(initial, initial);
  const normalized: Snapshot = {
    ...initial,
    commit: {
      dirtyLeaves: ['2'],
      dirtyElements: [['1', true]],
      normalized: ['2'],
      mutations: [],
      tags: [],
    },
  };
  comparison.compare(normalized, normalized);
  const reused: Snapshot = {
    ...initial,
    keys: [...initial.keys, { path: [0, 0], key: '2' }],
    commit: {
      dirtyLeaves: ['2'],
      dirtyElements: [['1', true]],
      normalized: [],
      mutations: [['2', 'created']],
      tags: [],
    },
  };
  expect(() => comparison.compare(reused, reused)).toThrow(
    'identity lifecycle'
  );
});
