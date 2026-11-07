import { afterEach, describe, expect, test } from 'vitest';
import { Encoder } from '../encode';
import { Entropy } from '../entropy';
import { isTestFrame } from '../attribution';
import { activate, Recorder, wrapModule } from '../membrane';

// covers: recorder:B1, recorder:B2, recorder:B3, recorder:B4, recorder:B7, recorder:B9
describe('recorder membrane', () => {
  afterEach(() => activate());

  test('attributes async plugin re-entry to its actual source', () => {
    expect(isTestFrame('Error\n at work (/upstream/packages/lexical/src/LexicalEvents.ts:1:1)\n at test (/upstream/packages/lexical/src/__tests__/test.ts:2:1)')).toBe(false);
    expect(isTestFrame('Error\n at test (/upstream/packages/lexical/src/__tests__/test.ts:2:1)')).toBe(true);
  });

  test('update closures keep their calls inside the update', () => {
    const recorder = new Recorder();
    activate(recorder);
    const api = wrapModule({ value: () => 17 }, 'fixture');
    const editor = { _editorState: {}, _config: { namespace: 'test' }, _rootElement: null,
      update: (callback: () => void) => callback() };
    const wrapped = recorder.wrap(editor);
    wrapped.update(() => api.value());
    expect(recorder.trace).toEqual([
      { op: 'createEditor', id: 0, config: { namespace: 'test', nodes: [], replacements: [], plugins: [], theme: {}, editable: true, rootElement: false }, ret: { $ed: 0 } },
      { op: 'update', editor: 0, id: 0, cause: 'test', opts: {}, calls: [{ op: 'call', fn: 'fixture.value', args: [], ret: 17 }] },
    ]);
  });

  test('predicate reads are in a tape, not the outer trace', () => {
    const recorder = new Recorder();
    activate(recorder);
    const api = wrapModule({ find: (predicate: (node: { getType(): string }) => boolean) => predicate(Object.assign({ getType: () => 'text' }, { __key: '1', __type: 'text' })) }, 'fixture');
    api.find((node: { getType(): string }) => node.getType() === 'text');
    expect(recorder.trace).toHaveLength(1);
    expect(recorder.tapes[0].invocations[0].calls).toEqual([
      { op: 'call', fn: 'Object.getType', this: { $h: 0 }, args: [], ret: 'text' },
    ]);
    expect(recorder.tapes[0].invocations[0].ret).toBe(true);
  });

  test('nested updates retain the parent id', () => {
    const recorder = new Recorder();
    activate(recorder);
    const wrapped = recorder.wrap({ _editorState: {}, _config: { namespace: 'test' }, _rootElement: null,
      update: (callback: () => void) => callback() });
    wrapped.update(() => wrapped.update(() => {}));
    expect(recorder.trace[1].calls).toEqual([
      { op: 'update', editor: 0, id: 1, parent: 0, cause: 'test', opts: {}, calls: [] },
    ]);
  });

  test('lazy arrays and maps preserve node identity', () => {
    const recorder = new Recorder();
    const node = { __key: '1', __type: 'text' };
    const array = recorder.wrap([node]);
    const map = recorder.wrap(new Map([['1', node]]));
    expect(array[0]).toBe(recorder.wrap(node));
    expect(map.get('1')).toBe(array[0]);
    expect([...array][0]).toBe(array[0]);
  });

  test('stale handles differ by object and retain their version', () => {
    const encoder = new Encoder();
    encoder.version = 1;
    const old = { __key: '1', __type: 'text', __text: 'before' };
    expect(encoder.encode(old)).toEqual({ $h: 0, key: '1', type: 'text', ver: 1 });
    encoder.version = 2;
    expect(encoder.encode({ ...old, __text: 'after' })).toEqual({ $h: 1, key: '1', type: 'text', ver: 2 });
    expect(encoder.encode(old)).toEqual({ $h: 0 });
    expect(old.__text).toBe('before');
  });

  test('records errors routed to a supplied handler', () => {
    const recorder = new Recorder();
    const editor = { _editorState: {}, _config: { namespace: 'test' }, _rootElement: null };
    recorder.error(editor, new Error('transform failed'), 'update');
    expect(recorder.trace[1]).toEqual({ op: 'error', editor: 0, during: 'update', name: 'Error', message: 'transform failed' });
  });

  test('untaped Math.random fails instead of using ambient randomness', () => {
    const entropy = new Entropy();
    entropy.install();
    try { expect(() => Math.random()).toThrow('untaped-entropy: random'); }
    finally { entropy.dispose(); }
  });
});
