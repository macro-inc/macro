import { expect, test } from 'vitest';
import { ConformanceBackend } from '../backend/conformance';

test('indexed text splicing preserves selection kinds and enforces the specified UTF-16 bounds', () => {
  const backend = new ConformanceBackend({
    namespace: 'text splice',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const text = backend.call('lexical.$createTextNode', ['ab😀cd']);
    backend.call('LexicalNode.append', [text], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    backend.call('LexicalNode.spliceText', [2, 2, 'Z', true], text);
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe('abZcd');
    expect(backend.call('lexical.$getSelection', [])).toBeNull();
    const selected = backend.call('lexical.$createNodeSelection', []);
    backend.call(
      'Selection.add',
      [backend.call('LexicalNode.getKey', [], text)],
      selected
    );
    backend.call('lexical.$setSelection', [selected]);
    const nodeSelection = backend.call('lexical.$getSelection', []);
    backend.call('LexicalNode.spliceText', [0, 1, 'Q', true], text);
    expect(backend.call('lexical.$getSelection', [])).toEqual(nodeSelection);
    const range = backend.call('LexicalNode.select', [0, 0], text);
    const active = backend.call('lexical.$getSelection', []);
    backend.call('LexicalNode.spliceText', [1, 1, 'XY', true], text);
    expect(backend.call('lexical.$getSelection', [])).toEqual(active);
    const anchor = backend.call('get:anchor', [], range);
    expect(backend.call('get:offset', [], anchor)).toBe(3);
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe('QXYZcd');
    backend.call('LexicalNode.setTextContent', ['😀ab'], text);
    expect(() =>
      backend.call('LexicalNode.spliceText', [1, 0, 'x'], text)
    ).toThrow();
    expect(() =>
      backend.call('LexicalNode.spliceText', [-1, 0, 'x'], text)
    ).toThrow();
    expect(() =>
      backend.call('LexicalNode.spliceText', [99, 0, 'x'], text)
    ).toThrow();
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe('😀ab');
    backend.call('LexicalNode.spliceText', [2, 0xffffffff, 'x'], text);
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe('😀x');
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('splicing a different text transfers composition through the existing range points', () => {
  const backend = new ConformanceBackend({
    namespace: 'splice composition',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const other = backend.call('lexical.$createTextNode', ['other']);
    const text = backend.call('lexical.$createTextNode', ['abcd']);
    backend.call('LexicalNode.append', [other, text], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    const range = backend.call('LexicalNode.select', [0, 2], other);
    backend.call('lexical.$setCompositionKey', [
      backend.call('LexicalNode.getKey', [], other),
    ]);
    const active = backend.call('lexical.$getSelection', []);
    backend.call('LexicalNode.spliceText', [1, 1, 'Z', true], text);
    expect(backend.call('lexical.$getCompositionKey', [])).toEqual(
      backend.call('LexicalNode.getKey', [], text)
    );
    expect(backend.call('lexical.$getSelection', [])).toEqual(active);
    const anchor = backend.call('get:anchor', [], range);
    expect(backend.call('get:offset', [], anchor)).toBe(2);
    expect(backend.call('Selection.getTextContent', [], range)).toBe('');
    backend.call('lexical.$setCompositionKey', [null]);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('node JSON updates and creation hooks preserve native paragraph fields and copy predicates', () => {
  const backend = new ConformanceBackend({
    namespace: 'node mutation hooks',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const text = backend.call('lexical.$createTextNode', ['old']);
    backend.call('LexicalNode.append', [text], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    backend.call(
      'LexicalNode.updateFromJSON',
      [
        {
          type: 'text',
          version: 1,
          text: 'updated',
          format: 2,
          style: 'color:blue',
          mode: 'normal',
          detail: 1,
        },
      ],
      text
    );
    backend.call('LexicalNode.setFormat', ['center'], p);
    backend.call('LexicalNode.setStyle', ['margin:0'], p);
    backend.call('LexicalNode.setDirection', ['rtl'], p);
    const selection = backend.call('LexicalNode.select', [1, 3], text);
    expect(backend.call('LexicalNode.isSelected', [], text)).toBe(true);
    expect(backend.call('LexicalNode.isSelected', [selection], text)).toBe(
      true
    );
    const after = backend.call(
      'LexicalNode.insertNewAfter',
      [selection, false],
      p
    );
    expect([
      backend.call('LexicalNode.getFormatType', [], after),
      backend.call('LexicalNode.getStyle', [], after),
      backend.call('LexicalNode.getDirection', [], after),
      backend.call('LexicalNode.getTextFormat', [], after),
      backend.call('LexicalNode.getTextStyle', [], after),
    ]).toEqual(['center', 'margin:0', 'rtl', 0, '']);
    const parent = backend.call(
      'LexicalNode.createParentElementNode',
      [],
      text
    );
    expect(backend.call('LexicalNode.getType', [], parent)).toBe('paragraph');
    expect(backend.call('LexicalNode.isAttached', [], parent)).toBe(false);
    expect(backend.call('LexicalNode.excludeFromCopy', [], p)).toBe(false);
    expect(backend.call('LexicalNode.excludeFromCopy', ['html'], p)).toBe(
      false
    );
    expect(
      backend.call(
        'LexicalNode.extractWithChild',
        [text, selection, 'clone'],
        p
      )
    ).toBe(false);
    expect(backend.call('LexicalNode.resetOnCopyNodeFrom', [p], after)).toEqual(
      { $undef: true }
    );
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe(
      'updated'
    );
    expect(backend.call('LexicalNode.getFormat', [], text)).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
