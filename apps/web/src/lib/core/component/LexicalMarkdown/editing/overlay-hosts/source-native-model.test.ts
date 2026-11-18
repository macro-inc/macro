import { expect, test } from 'vitest';
import {
  compareNodes,
  compareRoots,
  createIdPairing,
  serializedJSON,
  validateNodeIds,
} from './source-native-model';

const text = (id: string, value: string, extra: object = {}) => ({
  type: 'text',
  version: 1,
  text: value,
  $: { id },
  ...extra,
});

test('positive: kept ids pair by position across before and after', () => {
  const ids = createIdPairing();
  compareNodes([text('SourceA1', 'Hello')], [text('NativeA1', 'Hello')], ids);
  compareNodes(
    [text('SourceA1', 'Hel'), text('SourceB2', 'lo')],
    [text('NativeA1', 'Hel'), text('NativeB2', 'lo')],
    ids
  );
  expect([...ids.forward]).toEqual([
    ['SourceA1', 'NativeA1'],
    ['SourceB2', 'NativeB2'],
  ]);
});

test('negative: a missing node id fails validation', () => {
  expect(() =>
    validateNodeIds([{ type: 'text', version: 1, text: 'x', $: {} }])
  ).toThrow('node id missing');
  expect(() =>
    validateNodeIds([{ type: 'text', version: 1, text: 'x' }])
  ).toThrow('node id state missing');
});

test('negative: a duplicate node id fails validation', () => {
  expect(() =>
    validateNodeIds([
      {
        type: 'paragraph',
        version: 1,
        $: { id: 'AAAAAAAA' },
        children: [text('AAAAAAAA', 'x')],
      },
    ])
  ).toThrow('duplicate node id AAAAAAAA');
});

test('negative: a malformed node id fails validation and comparison', () => {
  expect(() => validateNodeIds([text('short', 'x')])).toThrow('malformed');
  expect(() => validateNodeIds([text('AAAA AAA', 'x')])).toThrow('malformed');
  expect(() =>
    compareNodes(
      [text('AAAAAAAA', 'x')],
      [text('AAAAAAA', 'x')],
      createIdPairing()
    )
  ).toThrow('malformed');
});

test('negative: a non-node $.id is compared exactly, never paired', () => {
  expect(() =>
    compareNodes(
      [text('SourceA1', 'x', { payload: { $: { id: 'Payload1' } } })],
      [text('NativeA1', 'x', { payload: { $: { id: 'Payload2' } } })],
      createIdPairing()
    )
  ).toThrow('children[0].payload');
});

test('negative: non-id node metadata drift fails', () => {
  expect(() =>
    compareNodes(
      [{ ...text('SourceA1', 'x'), $: { id: 'SourceA1', local: true } }],
      [{ ...text('NativeA1', 'x'), $: { id: 'NativeA1' } }],
      createIdPairing()
    )
  ).toThrow('children[0].$');
});

test('negative: a kept id rebound to another native id fails', () => {
  const ids = createIdPairing();
  compareNodes([text('SourceA1', 'x')], [text('NativeA1', 'x')], ids);
  expect(() =>
    compareNodes([text('SourceA1', 'x')], [text('NativeZ9', 'x')], ids)
  ).toThrow('was paired with NativeA1');
  expect(() =>
    compareNodes([text('SourceQ5', 'x')], [text('NativeA1', 'x')], ids)
  ).toThrow('was paired with SourceA1');
});

test('negative: a dropped default field fails', () => {
  expect(() =>
    compareNodes(
      [text('SourceA1', 'x', { detail: 0 })],
      [text('NativeA1', 'x')],
      createIdPairing()
    )
  ).toThrow('keys');
});

const METADATA = { documentMetadata: { version: 10 } };
const root = (state: unknown, children: unknown[]) => ({
  type: 'root',
  version: 1,
  $: state,
  children,
});
/** A root with no state at all, as Source's after a same-view replacement. */
const stateless = (children: unknown[]) => ({
  type: 'root',
  version: 1,
  children,
});

test('positive: roots compare their fields, states and children', () => {
  compareRoots(
    root({ id: 'SourceR1' }, [text('SourceA1', 'x')]),
    root(METADATA, [text('NativeA1', 'x')]),
    { source: 'id', native: METADATA },
    createIdPairing()
  );
});

test('negative: an extra Source root state field fails', () => {
  expect(() =>
    compareRoots(
      root({ id: 'SourceR1', local: true }, [text('SourceA1', 'x')]),
      root(METADATA, [text('NativeA1', 'x')]),
      { source: 'id', native: METADATA },
      createIdPairing()
    )
  ).toThrow('Source root state keys');
});

test('negative: a Source root id duplicated by a child fails', () => {
  expect(() =>
    compareRoots(
      root({ id: 'SourceA1' }, [text('SourceA1', 'x')]),
      root(METADATA, [text('NativeA1', 'x')]),
      { source: 'id', native: METADATA },
      createIdPairing()
    )
  ).toThrow('duplicate node id SourceA1');
});

test('negative: native root metadata drift fails', () => {
  expect(() =>
    compareRoots(
      root({ id: 'SourceR1' }, [text('SourceA1', 'x')]),
      root({ documentMetadata: { version: 11 } }, [text('NativeA1', 'x')]),
      { source: 'id', native: METADATA },
      createIdPairing()
    )
  ).toThrow('native root state');
});

test('positive: an absent Source root state matches the absent contract', () => {
  compareRoots(
    stateless([text('SourceA1', 'x')]),
    root(METADATA, [text('NativeA1', 'x')]),
    { source: 'absent', native: METADATA },
    createIdPairing()
  );
});

test('negative: a Source root id where the contract says absent fails', () => {
  expect(() =>
    compareRoots(
      root({ id: 'SourceR1' }, [text('SourceA1', 'x')]),
      root(METADATA, [text('NativeA1', 'x')]),
      { source: 'absent', native: METADATA },
      createIdPairing()
    )
  ).toThrow('Source root state should be absent');
});

test('negative: an absent Source root where the contract says id fails', () => {
  expect(() =>
    compareRoots(
      stateless([text('SourceA1', 'x')]),
      root(METADATA, [text('NativeA1', 'x')]),
      { source: 'id', native: METADATA },
      createIdPairing()
    )
  ).toThrow('Source root id state missing');
});

test('control: serialization drops an own undefined key and keeps null', () => {
  const live = { id: 'session', mentionUuid: undefined, label: null };
  expect(Object.keys(live)).toEqual(['id', 'mentionUuid', 'label']);
  expect(serializedJSON(live)).toStrictEqual({ id: 'session', label: null });
  // A real null difference still fails the exact comparison.
  expect(() =>
    compareNodes(
      [text('SourceA1', 'x', serializedJSON({ label: null }))],
      [text('NativeA1', 'x')],
      createIdPairing()
    )
  ).toThrow('keys');
});
