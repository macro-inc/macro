import { expect, test } from 'bun:test';
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';
import { diffBlocks } from '../src/entities/documents/lexical-diff';

function paragraph(id: string, text: string): SerializedLexicalNode {
  return {
    type: 'paragraph',
    version: 1,
    $: { id },
    children: [{ type: 'text', version: 1, text, $: { id: `${id}-text` } }],
  } as SerializedLexicalNode;
}

function list(
  id: string,
  items: SerializedLexicalNode[],
): SerializedLexicalNode {
  return {
    type: 'list',
    version: 1,
    listType: 'bullet',
    $: { id },
    children: items,
  } as SerializedLexicalNode;
}

function item(id: string, children: SerializedLexicalNode[]) {
  return {
    type: 'listitem',
    version: 1,
    $: { id },
    children,
  } as SerializedLexicalNode;
}

function state(...blocks: SerializedLexicalNode[]): SerializedEditorState {
  return {
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      $: { id: 'root' },
      children: blocks,
    },
  } as SerializedEditorState;
}

const base = state(
  paragraph('a', 'first'),
  paragraph('b', 'second'),
  paragraph('c', 'third'),
);

test('an unchanged state has an empty diff', () => {
  expect(diffBlocks(base, structuredClone(base))).toEqual({
    blocks: [],
    removed: [],
  });
});

test('key order does not count as a change', () => {
  const reordered = structuredClone(base);
  const [first] = reordered.root.children;
  reordered.root.children[0] = Object.fromEntries(
    Object.entries(first).reverse(),
  ) as SerializedLexicalNode;
  expect(diffBlocks(base, reordered)).toEqual({ blocks: [], removed: [] });
});

test('a text edit sends only that block, placed after its predecessor', () => {
  const edited = state(
    paragraph('a', 'first'),
    paragraph('b', 'second, edited'),
    paragraph('c', 'third'),
  );
  expect(diffBlocks(base, edited)).toEqual({
    blocks: [{ id: 'b', after: 'a', node: paragraph('b', 'second, edited') }],
    removed: [],
  });
});

test('an inserted block is sent with its predecessor, or null when first', () => {
  const inserted = state(
    paragraph('new-first', 'zero'),
    paragraph('a', 'first'),
    paragraph('b', 'second'),
    paragraph('new-middle', 'two and a half'),
    paragraph('c', 'third'),
  );
  expect(diffBlocks(base, inserted)).toEqual({
    blocks: [
      { id: 'new-first', after: null, node: paragraph('new-first', 'zero') },
      {
        id: 'new-middle',
        after: 'b',
        node: paragraph('new-middle', 'two and a half'),
      },
    ],
    removed: [],
  });
});

test('a moved block is sent once, at its new place', () => {
  const moved = state(
    paragraph('c', 'third'),
    paragraph('a', 'first'),
    paragraph('b', 'second'),
  );
  expect(diffBlocks(base, moved)).toEqual({
    blocks: [{ id: 'c', after: null, node: paragraph('c', 'third') }],
    removed: [],
  });
});

test('a removed block is listed by id', () => {
  const removed = state(paragraph('a', 'first'), paragraph('c', 'third'));
  expect(diffBlocks(base, removed)).toEqual({ blocks: [], removed: ['b'] });
});

test('an edit nested in a list sends the whole top-level list', () => {
  const nestedBase = state(
    paragraph('a', 'first'),
    list('l', [
      item('i1', [
        { type: 'text', version: 1, text: 'one' } as SerializedLexicalNode,
      ]),
      item('i2', [
        list('inner', [
          item('i3', [
            { type: 'text', version: 1, text: 'deep' } as SerializedLexicalNode,
          ]),
        ]),
      ]),
    ]),
  );
  const nestedEdit = structuredClone(nestedBase);
  const edited = list('l', [
    item('i1', [
      { type: 'text', version: 1, text: 'one' } as SerializedLexicalNode,
    ]),
    item('i2', [
      list('inner', [
        item('i3', [
          { type: 'text', version: 1, text: 'deeper' } as SerializedLexicalNode,
        ]),
      ]),
    ]),
  ]);
  nestedEdit.root.children[1] = edited;
  expect(diffBlocks(nestedBase, nestedEdit)).toEqual({
    blocks: [{ id: 'l', after: 'a', node: edited }],
    removed: [],
  });
});

test('a block without an id is a bug, not a silent skip', () => {
  const missing = structuredClone(base);
  delete missing.root.children[1].$;
  expect(() => diffBlocks(base, missing)).toThrow(/without an id/);
});
