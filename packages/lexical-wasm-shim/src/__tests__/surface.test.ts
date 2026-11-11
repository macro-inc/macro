import { expect, test } from 'vitest';
import { ConformanceBackend } from '../backend/conformance';

test('native predicates and composition checks use the model node kinds', () => {
  const backend = new ConformanceBackend({
    namespace: 'node predicates',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const q = backend.call('lexical.$createParagraphNode', []);
    const t = backend.call('lexical.$createTextNode', ['a']);
    backend.call('LexicalNode.append', [t], p);
    backend.call(
      'LexicalNode.append',
      [p, q],
      backend.call('lexical.$getRoot', [])
    );
    expect([
      backend.call('LexicalNode.isInline', [], p),
      backend.call('LexicalNode.canBeEmpty', [], p),
      backend.call('LexicalNode.canIndent', [], p),
      backend.call('LexicalNode.canMergeWhenEmpty', [], p),
      backend.call('LexicalNode.canMergeWith', [q], p),
      backend.call('LexicalNode.canReplaceWith', [q], p),
      backend.call('LexicalNode.canInsertAfter', [q], p),
      backend.call('LexicalNode.isShadowRoot', [], p),
      backend.call('LexicalNode.isParentRequired', [], p),
    ]).toEqual([false, true, true, false, false, true, true, false, false]);
    expect([
      backend.call('LexicalNode.isInline', [], t),
      backend.call('LexicalNode.isTextEntity', [], t),
      backend.call('LexicalNode.canHaveFormat', [], t),
      backend.call('LexicalNode.canInsertTextBefore', [], t),
      backend.call('LexicalNode.canInsertTextAfter', [], t),
      backend.call('LexicalNode.isComposing', [], t),
    ]).toEqual([true, false, true, true, true, false]);
    backend.call('lexical.$setCompositionKey', ['3']);
    expect(backend.call('LexicalNode.isComposing', [], t)).toBe(true);
    backend.call('lexical.$setCompositionKey', [null]);
    expect(backend.call('LexicalNode.isComposing', [], t)).toBe(false);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('element and text accessors preserve their distinct format, style and detail fields', () => {
  const backend = new ConformanceBackend({
    namespace: 'node fields',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    const p = backend.call('lexical.$createParagraphNode', []);
    const x = backend.call('lexical.$createTextNode', ['x']);
    const z = backend.call('lexical.$createTextNode', ['z']);
    backend.call('LexicalNode.append', [x, z], p);
    backend.call('LexicalNode.append', [p], root);
    backend.call('LexicalNode.setFormat', ['right'], p);
    backend.call('LexicalNode.setStyle', ['margin:0'], p);
    backend.call('LexicalNode.setTextFormat', [3], p);
    backend.call('LexicalNode.setDirection', ['rtl'], p);
    backend.call('LexicalNode.setIndent', [2], p);
    backend.call('LexicalNode.setDetail', [3], x);
    backend.call('LexicalNode.setMode', ['token'], x);
    backend.call('LexicalNode.setFormat', [1], x);
    backend.call('LexicalNode.setStyle', ['color:red'], x);
    expect([
      backend.call('LexicalNode.getFormat', [], p),
      backend.call('LexicalNode.getFormatType', [], p),
      backend.call('LexicalNode.getStyle', [], p),
      backend.call('LexicalNode.getTextFormat', [], p),
      backend.call('LexicalNode.hasFormat', ['left'], p),
      backend.call('LexicalNode.hasFormat', ['right'], p),
      backend.call('LexicalNode.hasTextFormat', ['bold'], p),
      backend.call('LexicalNode.getIndent', [], p),
      backend.call('LexicalNode.getDirection', [], p),
      backend.call('LexicalNode.getFormatFlags', ['underline', null], p),
    ]).toEqual([3, 'right', 'margin:0', 3, true, true, true, 2, 'rtl', 11]);
    expect([
      backend.call('LexicalNode.getDetail', [], x),
      backend.call('LexicalNode.getMode', [], x),
      backend.call('LexicalNode.isToken', [], x),
      backend.call('LexicalNode.isSegmented', [], x),
      backend.call('LexicalNode.isDirectionless', [], x),
      backend.call('LexicalNode.isUnmergeable', [], x),
      backend.call('LexicalNode.getFormat', [], x),
      backend.call('LexicalNode.getStyle', [], x),
    ]).toEqual([3, 'token', true, false, true, true, 1, 'color:red']);
    expect([
      backend.call('LexicalNode.getFormatFlags', ['bold'], z),
      backend.call('LexicalNode.getFormatFlags', ['bold', null], z),
      backend.call('LexicalNode.getFormatFlags', ['bold', { $undef: true }], z),
    ]).toEqual([0, 1, 0]);
    expect(backend.call('LexicalNode.isDirty', [], p)).toBe(true);
    expect(backend.call('LexicalNode.isDirty', [], x)).toBe(true);
    expect(backend.call('LexicalNode.is', [null], x)).toBe(false);
    expect(backend.call('LexicalNode.is', [{ $undef: true }], x)).toBe(false);
    backend.commit();
    backend.beginUpdate([], false);
    expect(backend.call('LexicalNode.isDirty', [], p)).toBe(false);
    backend.call('LexicalNode.markDirty', [], p);
    expect(backend.call('LexicalNode.isDirty', [], p)).toBe(true);
    expect(backend.call('LexicalNode.isDirty', [], x)).toBe(false);
    backend.call('LexicalNode.setDetail', ['directionless'], x);
    expect(backend.call('LexicalNode.getDetail', [], x)).toBe(1);
    backend.call('LexicalNode.setMode', ['segmented'], x);
    expect(backend.call('LexicalNode.isSegmented', [], x)).toBe(true);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('tree queries retain sibling order, top-level identity and crossed ancestors', () => {
  const backend = new ConformanceBackend({ namespace: 'node tree', nodes: [] });
  try {
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    const p = backend.call('lexical.$createParagraphNode', []);
    const x = backend.call('lexical.$createTextNode', ['x']);
    const y = backend.call('lexical.$createTextNode', ['y']);
    const q = backend.call('lexical.$createParagraphNode', []);
    const z = backend.call('lexical.$createTextNode', ['z']);
    backend.call('LexicalNode.append', [x, y], p);
    backend.call('LexicalNode.append', [z], q);
    backend.call('LexicalNode.append', [p, q], root);
    const currentRoot = backend.call('LexicalNode.getLatest', [], root);
    const [pHandle, xHandle, yHandle, qHandle, zHandle, rootHandle] = [
      p,
      x,
      y,
      q,
      z,
      currentRoot,
    ].map((node) => {
      if (
        node === null ||
        typeof node !== 'object' ||
        !('$h' in node) ||
        typeof node.$h !== 'number'
      )
        throw new Error('Expected an actual issued node handle');
      return node.$h;
    });
    expect(backend.call('LexicalNode.getChildrenKeys', [], p)).toEqual([
      { $key: xHandle, raw: '2' },
      { $key: yHandle, raw: '3' },
    ]);
    const parents = backend.call('LexicalNode.getParents', [], x);
    if (!Array.isArray(parents)) throw new Error('expected parent array');
    expect(
      parents.map((node) => backend.call('LexicalNode.getKey', [], node))
    ).toEqual([
      { $key: pHandle, raw: '1' },
      { $key: rootHandle, raw: 'root' },
    ]);
    const previous = backend.call('LexicalNode.getPreviousSiblings', [], y);
    if (!Array.isArray(previous)) throw new Error('expected sibling array');
    expect(
      previous.map((node) => backend.call('LexicalNode.getKey', [], node))
    ).toEqual([{ $key: xHandle, raw: '2' }]);
    const next = backend.call('LexicalNode.getNextSiblings', [], x);
    if (!Array.isArray(next)) throw new Error('expected sibling array');
    expect(
      next.map((node) => backend.call('LexicalNode.getKey', [], node))
    ).toEqual([{ $key: yHandle, raw: '3' }]);
    const between = backend.call('LexicalNode.getNodesBetween', [z], x);
    if (!Array.isArray(between)) throw new Error('expected node array');
    expect(
      between.map((node) => backend.call('LexicalNode.getKey', [], node))
    ).toEqual([
      { $key: xHandle, raw: '2' },
      { $key: yHandle, raw: '3' },
      { $key: pHandle, raw: '1' },
      { $key: qHandle, raw: '4' },
      { $key: zHandle, raw: '5' },
    ]);
    expect(backend.call('LexicalNode.getTopLevelElement', [], x)).toEqual({
      $h: pHandle,
    });
    expect(
      backend.call('LexicalNode.getTopLevelElementOrThrow', [], x)
    ).toEqual({ $h: pHandle });
    expect(backend.call('LexicalNode.getTopLevelElement', [], root)).toBeNull();
    expect(backend.call('LexicalNode.getDescendantByIndex', [0], p)).toEqual({
      $h: xHandle,
    });
    expect(backend.call('LexicalNode.getDescendantByIndex', [99], p)).toEqual({
      $h: yHandle,
    });
    expect(backend.call('LexicalNode.getCommonAncestor', [y], x)).toEqual({
      $h: pHandle,
    });
    expect(backend.call('LexicalNode.getCommonAncestor', [x], p)).toEqual({
      $h: pHandle,
    });
    expect(backend.call('LexicalNode.isLastChild', [], p)).toBe(false);
    expect(backend.call('LexicalNode.isLastChild', [], q)).toBe(true);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
