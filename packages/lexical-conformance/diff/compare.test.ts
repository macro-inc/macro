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

test('paired caret errors allow only empty recovery with atomic Rust rollback', () => {
  const comparison = new Comparison();
  comparison.compare(initial, initial);
  const rejected: Snapshot = {
    ...initial,
    error: 'UTF-16 offset Utf16Offset(5) is out of range',
  };
  const recovered: Snapshot = {
    ...rejected,
    commit: {
      dirtyLeaves: [],
      dirtyElements: [],
      normalized: [],
      mutations: [],
      tags: [],
    },
  };
  comparison.compare(recovered, rejected);
  expect(() =>
    comparison.compare(
      { ...recovered, text: 'changed' },
      { ...rejected, text: 'changed' }
    )
  ).toThrow('atomic rollback');
  expect(() =>
    comparison.compare(
      {
        ...recovered,
        commit: {
          dirtyLeaves: [],
          dirtyElements: [],
          normalized: [],
          mutations: [],
          tags: ['changed'],
        },
      },
      rejected
    )
  ).toThrow('commit presence');
});
