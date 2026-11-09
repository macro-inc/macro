import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('extractWithChild preserves direct child and selection handles, extra arguments and native super', () => {
  const hook = foreignHookIndex().indexOf('extractWithChild');
  const backend = new ConformanceBackend({
    namespace: 'direct extraction',
    nodes: [
      {
        type: 'extract-element',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let child: unknown;
  let selection: unknown;
  let calls = 0;
  try {
    backend.installForeign('extract-element', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(handles.node(message.args[0])).toBe(handles.node(child));
      expect(message.args[1]).toEqual(selection);
      expect(message.args.slice(2)).toEqual(['clone', 'extra']);
      expect(
        backend.callNative(
          'LexicalNode.extractWithChild',
          message.args,
          message.node
        )
      ).toBe(false);
      expect(backend.call('Selection.isCollapsed', [], message.args[1])).toBe(
        false
      );
      expect(() =>
        backend.call('LexicalNode.setIndent', [1], message.node)
      ).toThrow(/read-only/);
      return {};
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'extract-element',
      {},
    ]);
    child = backend.call('lexical.$createTextNode', ['text']);
    handles.node(child);
    backend.call('LexicalNode.append', [child], node);
    backend.call(
      'LexicalNode.append',
      [node],
      backend.call('lexical.$getRoot', [])
    );
    selection = backend.call('LexicalNode.select', [1, 3], child);
    expect(
      backend.call(
        'LexicalNode.extractWithChild',
        [child, selection, 'clone', 'extra'],
        node
      )
    ).toBe(true);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('extractWithChild retains null and encoded undefined selection arguments', () => {
  const hook = foreignHookIndex().indexOf('extractWithChild');
  const backend = new ConformanceBackend({
    namespace: 'empty extraction selection',
    nodes: [
      {
        type: 'extract-empty',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const seen: unknown[] = [];
  try {
    backend.installForeign('extract-empty', (message) => {
      seen.push(message.args[1]);
      expect(message.args[2]).toBe('html');
      expect(
        backend.callNative(
          'LexicalNode.extractWithChild',
          message.args,
          message.node
        )
      ).toBe(false);
      return 0;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'extract-empty',
      {},
    ]);
    const child = backend.call('lexical.$createTextNode', ['text']);
    expect(
      backend.call('LexicalNode.extractWithChild', [child, null, 'html'], node)
    ).toBe(false);
    expect(
      backend.call(
        'LexicalNode.extractWithChild',
        [child, { $undef: true }, 'html'],
        node
      )
    ).toBe(false);
    expect(seen).toEqual([null, { $undef: true }]);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('native markdown extraction retains its explicit selection object and recovers from an opaque throw', () => {
  const extract = foreignHookIndex().indexOf('extractWithChild');
  const inline = foreignHookIndex().indexOf('isInline');
  const backend = new ConformanceBackend({
    namespace: 'native markdown extraction',
    nodes: [
      {
        type: 'extract-inline',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (
          (1n << BigInt(extract)) |
          (1n << BigInt(inline))
        ).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  const opaque = {};
  let wrapper: unknown;
  let selection: unknown;
  let fail = true;
  let calls = 0;
  try {
    backend.installForeign('extract-inline', (message) => {
      if (message.hook === inline) return true;
      calls++;
      expect(message.hook).toBe(extract);
      expect(handles.node(message.args[0])).toBe(handles.node(wrapper));
      if (
        selection === null ||
        typeof selection !== 'object' ||
        !('$sel' in selection)
      )
        throw new Error('expected selection');
      expect(message.args[1]).toMatchObject({ $sel: selection.$sel });
      expect(message.args[2]).toBe('html');
      expect(
        backend.call('Selection.getTextContent', [], message.args[1])
      ).toBe('bc');
      expect(
        backend.callNative(
          'LexicalNode.extractWithChild',
          message.args,
          message.node
        )
      ).toBe(false);
      if (fail) throw opaque;
      return true;
    });
    backend.beginUpdate([], false);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    wrapper = backend.call('conformance.createForeignNode', [
      'extract-inline',
      {},
    ]);
    handles.node(wrapper);
    const text = backend.call('lexical.$createTextNode', ['abcd']);
    backend.call('LexicalNode.append', [text], wrapper);
    backend.call('LexicalNode.append', [wrapper], paragraph);
    backend.call(
      'LexicalNode.append',
      [paragraph],
      backend.call('lexical.$getRoot', [])
    );
    selection = backend.call('LexicalNode.select', [1, 3], text);
    try {
      backend.call('@lexical/markdown.$convertSelectionToMarkdownString', [
        [],
        selection,
      ]);
      throw new Error('extraction must throw');
    } catch (error) {
      expect(error).toBe(opaque);
    }
    expect(calls).toBe(1);
    expect(backend.call('Selection.getTextContent', [], selection)).toBe('bc');
    fail = false;
    expect(
      backend.call('@lexical/markdown.$convertSelectionToMarkdownString', [
        [],
        selection,
      ])
    ).toBe('bc');
    expect(calls).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
