import { expect, test } from 'vitest';
import { ListenerMetadataCache } from './listener-metadata';

test('unknown admission never invents priorities and a guarded getter invalidates Only', () => {
  let token = 1n;
  const cache = new ListenerMetadataCache(
    () => token,
    () => true
  );
  expect(cache.needsKeyDown('x')).toBe(true);
  expect(cache.levels('KeyDown', 'x')).toBeUndefined();
  cache.accept(
    {
      rows: [
        { command: 'KeyDown', priority: 2 },
        { command: 'KeyDownOnly:["ArrowUp","ArrowDown"]', priority: 2 },
        { command: 'ListenerTableGeneration:1:1', priority: 0 },
      ],
    },
    'cold',
    token
  );
  expect(cache.needsKeyDown('x')).toBe(false);
  expect(cache.levels('KeyDown', 'x')).toBe(0);
  expect(cache.levels('KeyDown')).toBe(2);
  expect(cache.needsKeyDown('ArrowUp')).toBe(true);
  token++;
  expect(cache.needsKeyDown('x')).toBe(true);
  expect(cache.levels('KeyDown', 'x')).toBe(2);
  expect(cache.levels('KeyDown')).toBe(2);
});

test('All at another real priority remains eligible while Only recovers after removal', () => {
  let token = 1n;
  const cache = new ListenerMetadataCache(
    () => token,
    () => true
  );
  cache.accept(
    {
      rows: [
        { command: 'KeyDown', priority: 10 },
        { command: 'KeyDownOnly:["ArrowUp","ArrowDown"]', priority: 2 },
        { command: 'ListenerTableGeneration:1:9007199254740993', priority: 0 },
      ],
    },
    'output',
    token
  );
  expect(cache.needsKeyDown('x')).toBe(true);
  expect(cache.levels('KeyDown', 'x')).toBe(8);
  expect(cache.levels('KeyDown', 'ArrowUp')).toBe(10);
  cache.invalidate();
  expect(cache.levels('KeyDown', 'x')).toBe(10);
  token++;
  cache.accept(
    {
      rows: [
        { command: 'KeyDown', priority: 2 },
        { command: 'KeyDownOnly:["ArrowUp","ArrowDown"]', priority: 2 },
        { command: 'ListenerTableGeneration:1:9007199254740994', priority: 0 },
      ],
    },
    'cold',
    token
  );
  expect(cache.needsKeyDown('x')).toBe(false);
  expect(cache.levels('KeyDown', 'x')).toBe(0);
});

test('older output cannot downgrade a cold table and same-generation inconsistency faults', () => {
  let token = 1n;
  const cache = new ListenerMetadataCache(
    () => token,
    () => true
  );
  const rows = [
    { command: 'KeyDown', priority: 2 },
    { command: 'KeyDownOnly:["ArrowUp"]', priority: 2 },
    { command: 'ListenerTableGeneration:1:9', priority: 0 },
  ];
  cache.accept({ rows }, 'cold', token);
  cache.accept(
    { rows: [{ command: 'ListenerTableGeneration:1:8', priority: 0 }] },
    'output',
    token
  );
  expect(cache.needsKeyDown('x')).toBe(false);
  expect(() =>
    cache.accept(
      {
        rows: [
          { command: 'KeyDown', priority: 16 },
          { command: 'ListenerTableGeneration:1:9', priority: 0 },
        ],
      },
      'output',
      token
    )
  ).toThrow('Inconsistent listener table');
  cache.accept({ rows }, 'cold', token);
  expect(cache.needsKeyDown('x')).toBe(true);
  expect(cache.levels('KeyDown', 'x')).toBe(2);
  token++;
  cache.accept(
    {
      rows: [
        { command: 'KeyDown', priority: 2 },
        { command: 'KeyDownOnly:["ArrowUp"]', priority: 2 },
        { command: 'ListenerTableGeneration:1:10', priority: 0 },
      ],
    },
    'output',
    token
  );
  expect(cache.needsKeyDown('x')).toBe(false);
});

test.each([
  { command: 'ListenerTableGeneration:1:unavailable', priority: 0 },
  { command: 'ListenerTableGeneration:1:01', priority: 0 },
  { command: 'ListenerTableGeneration:1:18446744073709551616', priority: 0 },
  { command: 'ListenerTableGeneration:2:1', priority: 0 },
  { command: 'KeyDownFuture:[]', priority: 2 },
  { command: 'KeyDownOnly:[1]', priority: 2 },
  { command: 'KeyDownOnly:["x","x"]', priority: 2 },
])('unknown metadata $command never authorizes a negative', (invalid) => {
  const cache = new ListenerMetadataCache(
    () => 1n,
    () => true
  );
  cache.accept({ rows: [invalid] }, 'output', 1n);
  expect(cache.needsKeyDown('x')).toBe(true);
});

test('late callback token, missing owner, and close cannot authorize stale output', () => {
  let token = 1n;
  let bound = true;
  const cache = new ListenerMetadataCache(
    () => token,
    () => bound
  );
  const table = {
    rows: [
      { command: 'KeyDown', priority: 2 },
      { command: 'KeyDownOnly:["ArrowUp"]', priority: 2 },
      { command: 'ListenerTableGeneration:1:1', priority: 0 },
    ],
  };
  token++;
  cache.accept(table, 'output', 1n);
  expect(cache.needsKeyDown('x')).toBe(true);
  cache.accept(table, 'cold', token);
  bound = false;
  expect(cache.needsKeyDown('x')).toBe(true);
  bound = true;
  cache.close();
  cache.accept(table, 'cold', token);
  expect(cache.needsKeyDown('x')).toBe(true);
});

test.each([
  { rows: [{ command: 'KeyDownOnly:[', priority: 2 }] },
  {
    rows: [
      { command: 'KeyDown', priority: 2 },
      { command: 'KeyDown', priority: 2 },
    ],
  },
  { rows: [{ command: 'KeyDown', priority: 32 }] },
])(
  'rejecting malformed metadata invalidates an already fresh cache (case %#)',
  ({ rows }) => {
    const cache = new ListenerMetadataCache(
      () => 1n,
      () => true
    );
    cache.accept(
      {
        rows: [
          { command: 'KeyDown', priority: 2 },
          { command: 'KeyDownOnly:["ArrowUp"]', priority: 2 },
          { command: 'ListenerTableGeneration:1:1', priority: 0 },
        ],
      },
      'cold',
      1n
    );
    expect(cache.needsKeyDown('x')).toBe(false);
    expect(() => cache.accept({ rows }, 'output', 1n)).toThrow();
    expect(cache.needsKeyDown('x')).toBe(true);
    expect(cache.levels('KeyDown', 'x')).toBe(2);
  }
);

test('valid exhausted-generation transport never authorizes Only', () => {
  const cache = new ListenerMetadataCache(
    () => 1n,
    () => true
  );
  expect(
    cache.accept(
      {
        rows: [
          { command: 'KeyDown', priority: 2 },
          { command: 'KeyDownOnly:["ArrowUp"]', priority: 2 },
          { command: 'ListenerTableGeneration:1:unavailable', priority: 0 },
        ],
      },
      'output',
      1n
    )
  ).toBe(true);
  expect(cache.needsKeyDown('x')).toBe(true);
  expect(cache.levels('KeyDown', 'x')).toBeUndefined();
  expect(
    cache.accept(
      {
        rows: [
          { command: 'ListenerTableGeneration:2:unavailable', priority: 0 },
        ],
      },
      'output',
      1n
    )
  ).toBe(false);
});
