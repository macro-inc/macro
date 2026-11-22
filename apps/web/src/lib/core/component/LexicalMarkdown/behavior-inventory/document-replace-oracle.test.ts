// Source oracle for the native document replace and statistics port.
// Runs the actual Source plugins and records results by tree path; the native
// tests in crates/client/lexical/macro_document_model replay it.
// Regenerate with UPDATE_DOCUMENT_REPLACE_ORACLE=1.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { $createCodeNode } from '@lexical/code';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import {
  $createDocumentMentionNode,
  $createEquationNode,
  $createHorizontalRuleNode,
  $createImageNode,
  $createUserMentionNode,
} from '@macro-inc/lexical-core';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { expect, it } from 'vitest';
import {
  DO_REPLACE_COMMAND,
  DO_REPLACE_ONCE_COMMAND,
  DO_SEARCH_COMMAND,
  findAndReplacePlugin,
  type NodekeyOffset,
} from '../plugins/find-and-replace/findAndReplacePlugin';
import { $getProgressStats } from '../plugins/progress/progressPlugin';
import { behaviorEditor } from './editor';

// Vitest runs from apps/web.
const ORACLE = resolve(
  process.cwd(),
  '../../crates/client/lexical/macro_document_model/src/plugins_group_b/document_find/replace-oracle.json'
);

const text = (value: string, format = 0) =>
  $createTextNode(value).setFormat(format);
const paragraph = (...children: LexicalNode[]) =>
  $createParagraphNode().append(...children);
const item = (checked: boolean | undefined, ...children: LexicalNode[]) =>
  $createListItemNode(checked).append(...children);

type Fixture = {
  name: string;
  build: () => LexicalNode[];
  searches: string[];
  replace?: string;
};

const FIXTURES: Fixture[] = [
  {
    name: 'case-insensitive',
    build: () => [paragraph(text('Apple one apple two APPLE three.'))],
    searches: ['apple', 'APPLE', 'e', 'three.', 'zzz'],
    replace: 'pear',
  },
  {
    name: 'across-formatting',
    build: () => [
      paragraph(text('Split ap'), text('ple', 1), text(' and apple', 2)),
    ],
    searches: ['apple', 'pple and', 'ple'],
    replace: 'pear',
  },
  {
    name: 'same-node-repeats',
    build: () => [paragraph(text('apple apple apple'))],
    searches: ['apple', 'pple a'],
    replace: 'pineapple',
  },
  {
    name: 'unicode',
    build: () => [
      paragraph(text('École école ÉCOLE')),
      paragraph(text('straße STRASSE ſ s')),
      paragraph(text('Kelvin K k K')),
      paragraph(text('İ i I ı')),
      paragraph(text('😀a 😀A 😀 a')),
      paragraph(text('é é')),
    ],
    searches: ['école', 'ß', 's', 'k', 'i', '😀a', '😀', 'é', 'a'],
    replace: '🍐',
  },
  {
    name: 'regex-metacharacters',
    build: () => [paragraph(text('a+b (x) [y] $1 ^c . * ? | \\ {2}'))],
    searches: [
      'a+b',
      '(x)',
      '[y]',
      '$1',
      '^c',
      '.',
      '*',
      '?',
      '|',
      '\\',
      '{2}',
    ],
    replace: '#',
  },
  {
    name: 'blocks',
    build: () => [
      $createHeadingNode('h1').append(text('Heading end')),
      paragraph(text('start here')),
      $createQuoteNode().append(text('quote end')),
      paragraph(),
      paragraph(text('foo'), $createLineBreakNode(), text('bar')),
      paragraph(text('tab'), $createTabNode(), text('bed')),
    ],
    searches: ['end', 'endstart', 'end start', 'foobar', 'tabbed', 'e'],
    replace: 'X',
  },
  {
    name: 'lists',
    build: () => [
      $createListNode('bullet').append(
        item(undefined, text('a apple')),
        item(
          undefined,
          $createListNode('bullet').append(item(undefined, text('apple b')))
        )
      ),
      $createListNode('check').append(
        item(true, text('done apple')),
        item(false, text('todo')),
        item(true, text('   ')),
        item(false),
        item(
          false,
          $createListNode('check').append(item(true, text('nested apple')))
        )
      ),
      $createListNode('number').append(item(undefined, text('numbered'))),
    ],
    searches: ['apple', 'a apple', 'applenested'],
    replace: 'pear',
  },
  {
    name: 'mentions',
    build: () => [
      paragraph(
        text('Hi '),
        $createUserMentionNode({
          userId: 'user-1',
          email: 'user@example.invalid',
          displayName: 'Apple Person',
          mentionUuid: 'mention-1',
        }),
        text(' see '),
        $createDocumentMentionNode({
          documentId: 'doc-1',
          documentName: 'Apple doc',
          blockName: 'md',
          mentionUuid: 'mention-2',
          createdAt: 0,
        }),
        text(' apple')
      ),
    ],
    searches: ['apple', '@apple', 'person see', 'doc apple'],
    replace: 'pear',
  },
  {
    name: 'ignored-and-not-really-inline',
    build: () => [
      paragraph(
        text('before apple'),
        $createEquationNode('apple', true),
        text('after')
      ),
      $createHorizontalRuleNode(),
      paragraph(
        text('img'),
        $createImageNode({
          srcType: 'url',
          url: 'https://example.invalid/a.png',
          alt: 'apple',
        }),
        text('next')
      ),
      $createEquationNode('apple', false),
    ],
    searches: ['apple', 'appleafter', 'imgnext', 'img'],
    replace: 'pear',
  },
  {
    name: 'code',
    // The app's trailing-paragraph plugin keeps a paragraph after a final code block.
    build: () => [
      $createCodeNode('javascript').append(text('const apple = 1;')),
      paragraph(),
    ],
    searches: ['apple', 'const'],
    replace: 'pear',
  },
];

function path(key: string): number[] {
  const out: number[] = [];
  let node = $getNodeByKey(key);
  while (node && node.getParent()) {
    out.unshift(node.getIndexWithinParent());
    node = node.getParent();
  }
  return out;
}

function setup(fixture: Fixture) {
  let offsets: NodekeyOffset[] = [];
  const { editor } = behaviorEditor(
    findAndReplacePlugin({
      getListOffset: () => offsets,
      setListOffset: (next) => {
        offsets = next;
      },
    })
  );
  editor.update(
    () =>
      $getRoot()
        .clear()
        .append(...fixture.build()),
    {
      discrete: true,
    }
  );
  const search = (query: string) => {
    offsets = [];
    editor.update(() => editor.dispatchCommand(DO_SEARCH_COMMAND, query), {
      discrete: true,
    });
    return offsets;
  };
  return { editor, search };
}

const read = <T>(editor: LexicalEditor, fn: () => T) =>
  editor.getEditorState().read(fn);

const pieces = (editor: LexicalEditor, offsets: NodekeyOffset[]) =>
  read(editor, () =>
    offsets.map((offset) => ({
      path: path(offset.key),
      start: offset.offset.start,
      end: offset.offset.end,
      isReplace: offset.offset.isReplace,
      pairKey: offset.pairKey,
    }))
  );

const children = (editor: LexicalEditor) =>
  editor.getEditorState().toJSON().root.children;

function replaced(
  fixture: Fixture,
  query: string,
  replaceString: string,
  pair: number | undefined
) {
  const { editor, search } = setup(fixture);
  const offsets = search(query);
  const list =
    pair === undefined
      ? offsets
      : offsets.filter((offset) => offset.pairKey === pair);
  editor.update(
    () =>
      editor.dispatchCommand(
        pair === undefined ? DO_REPLACE_COMMAND : DO_REPLACE_ONCE_COMMAND,
        { replaceString, nodeKeyOffsetList: list }
      ),
    { discrete: true }
  );
  return {
    children: children(editor),
    nodeSelection: read(editor, () => {
      const selection = $getSelection();
      return $isNodeSelection(selection)
        ? selection.getNodes().map((node) => path(node.getKey()))
        : null;
    }),
  };
}

function stats(editor: LexicalEditor) {
  return read(editor, () => ({
    text: $getRoot()
      .getChildren()
      .map((child) => child.getTextContent())
      .join('\n'),
    progress: $getProgressStats(),
  }));
}

function oracle() {
  return Object.fromEntries(
    FIXTURES.map((fixture) => {
      const { editor, search } = setup(fixture);
      const searches = fixture.searches.map((query) => ({
        query,
        pieces: pieces(editor, search(query)),
      }));
      const replaceString = fixture.replace;
      const replacements = replaceString
        ? fixture.searches.map((query) => {
            const matches = Math.max(
              0,
              ...search(query).map((offset) => offset.pairKey ?? 0)
            );
            return {
              query,
              replaceString,
              all: replaced(fixture, query, replaceString, undefined),
              once: Array.from(
                { length: Math.min(matches, 2) },
                (_, index) => ({
                  pair: index + 1,
                  ...replaced(fixture, query, replaceString, index + 1),
                })
              ),
            };
          })
        : [];
      return [
        fixture.name,
        {
          input: { root: editor.getEditorState().toJSON().root },
          searches,
          replacements,
          stats: stats(editor),
        },
      ];
    })
  );
}

it('native document find oracle matches the Source plugins', () => {
  const actual = `${JSON.stringify(oracle(), null, 2)}\n`;
  if (process.env.UPDATE_DOCUMENT_REPLACE_ORACLE === '1')
    writeFileSync(ORACLE, actual);
  expect(readFileSync(ORACLE, 'utf8')).toBe(actual);
});

it('element children inside the oracle are not inline', () => {
  const { editor } = setup(FIXTURES[0]);
  read(editor, () =>
    expect($getRoot().getChildren().every($isElementNode)).toBe(true)
  );
});
