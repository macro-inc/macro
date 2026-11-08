import { expect, test } from 'vitest';
import { ConformanceBackend } from '../backend/conformance';

test('host suspension and rollback preserve detached direction memos while explicit clones clear them', () => {
  const backend = new ConformanceBackend({
    namespace: 'selection memo',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const selection = backend.call('lexical.$createRangeSelection', []);
    expect(backend.call('Selection.isBackward', [], selection)).toBe(false);
    expect(backend.call('get:_cachedIsBackward', [], selection)).toBe(false);
    expect(backend.finishNoop()).toBe(true);
    backend.beginUpdate([], false);
    expect(backend.call('get:_cachedIsBackward', [], selection)).toBe(false);
    expect(backend.call('get:dirty', [], selection)).toBe(false);
    const copy = backend.call('Selection.clone', [], selection);
    expect(backend.call('get:_cachedIsBackward', [], copy)).toBeNull();
    backend.discard();
    backend.beginUpdate([], false);
    expect(backend.call('get:_cachedIsBackward', [], selection)).toBe(false);
    expect(() => backend.call('Selection.isBackward', [], copy)).toThrow();
    expect(backend.finishNoop()).toBe(true);
  } finally {
    backend.dispose();
  }
});

test('replacing the active selection keeps the old object direction memo through publication', () => {
  const backend = new ConformanceBackend({
    namespace: 'selection replacement',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const text = backend.call('lexical.$createTextNode', ['abcd']);
    backend.call('LexicalNode.append', [text], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    const previous = backend.call('LexicalNode.select', [3, 1], text);
    expect(backend.call('Selection.isBackward', [], previous)).toBe(true);
    const next = backend.call('lexical.$createRangeSelection', []);
    expect(backend.call('Selection.isBackward', [], next)).toBe(false);
    backend.call('lexical.$setSelection', [next]);
    expect(backend.call('get:_cachedIsBackward', [], previous)).toBe(true);
    expect(backend.call('get:_cachedIsBackward', [], next)).toBe(false);
    backend.commit();
    backend.beginUpdate([], false);
    expect(backend.call('get:_cachedIsBackward', [], previous)).toBe(true);
    const copy = backend.call('Selection.clone', [], previous);
    expect(backend.call('get:_cachedIsBackward', [], copy)).toBeNull();
    expect(backend.finishNoop()).toBe(true);
  } finally {
    backend.dispose();
  }
});
