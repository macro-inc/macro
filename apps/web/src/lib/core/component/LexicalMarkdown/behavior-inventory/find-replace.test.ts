import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import {
  DO_REPLACE_COMMAND,
  DO_REPLACE_ONCE_COMMAND,
  DO_SEARCH_COMMAND,
  findAndReplacePlugin,
  type NodekeyOffset,
} from '../plugins/find-and-replace/findAndReplacePlugin';
import { behaviorEditor } from './editor';

function searchable(text: string) {
  let offsets: NodekeyOffset[] = [];
  const changed = vi.fn((next: NodekeyOffset[]) => {
    offsets = next;
  });
  const { editor } = behaviorEditor(
    findAndReplacePlugin({
      getListOffset: () => offsets,
      setListOffset: changed,
    })
  );
  editor.update(
    () =>
      $getRoot().append($createParagraphNode().append($createTextNode(text))),
    { discrete: true }
  );
  const search = (query: string) => {
    editor.update(
      () => {
        expect(editor.dispatchCommand(DO_SEARCH_COMMAND, query)).toBe(true);
      },
      { discrete: true }
    );
    return offsets;
  };
  return { editor, search, changed };
}

describe('find and replace literal search', () => {
  it.each([
    {
      text: 'One ONE',
      query: 'one',
      ranges: [
        [0, 3],
        [4, 7],
      ],
    },
    {
      text: 'a+b ab a+b',
      query: 'a+b',
      ranges: [
        [0, 3],
        [7, 10],
      ],
    },
    { text: '[a]+ aaa', query: '[a]+', ranges: [[0, 4]] },
    {
      text: 'aaaa',
      query: 'aa',
      ranges: [
        [0, 2],
        [2, 4],
      ],
    },
    { text: 'retained', query: '', ranges: [] },
    { text: 'retained', query: 'absent', ranges: [] },
  ])(
    'maps literal "$query" in "$text" to actual text-node offsets',
    ({ text, query, ranges }) => {
      const { editor, search } = searchable(text);
      const offsets = search(query);
      expect(
        offsets.map((entry) => [entry.offset.start, entry.offset.end])
      ).toEqual(ranges);
      expect(offsets.map((entry) => entry.offset.isReplace)).toEqual(
        ranges.map(() => true)
      );
      expect(offsets.map((entry) => entry.pairKey)).toEqual(
        ranges.map((_, index) => index + 1)
      );
      editor.read(() => expect($getRoot().getTextContent()).toBe(text));
    }
  );

  it('only reports offsets when the search result changes', () => {
    const { search, changed } = searchable('one one');
    search('one');
    expect(changed).toHaveBeenCalledTimes(1);
    search('one');
    expect(changed).toHaveBeenCalledTimes(1);
    search('absent');
    expect(changed).toHaveBeenCalledTimes(2);
    search('absent');
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

for (const once of [false, true]) {
  describe(`find and replace edits (once=${once})`, () => {
    it.each([
      {
        text: 'one one',
        query: 'one',
        replacement: 'x',
        all: 'x x',
        first: 'x one',
      },
      {
        text: 'ab ab',
        query: 'ab',
        replacement: 'long',
        all: 'long long',
        first: 'long ab',
      },
      {
        text: 'one one',
        query: 'one',
        replacement: '',
        all: ' ',
        first: ' one',
      },
      {
        text: 'One ONE',
        query: 'one',
        replacement: 'x',
        all: 'x x',
        first: 'x ONE',
      },
      {
        text: 'a+b a+b',
        query: 'a+b',
        replacement: 'x',
        all: 'x x',
        first: 'x a+b',
      },
    ])(
      'replaces "$query" with "$replacement" in "$text"',
      ({ text, query, replacement, all, first }) => {
        const { editor, search } = searchable(text);
        const offsets = search(query);
        editor.update(
          () => {
            expect(
              editor.dispatchCommand(
                once ? DO_REPLACE_ONCE_COMMAND : DO_REPLACE_COMMAND,
                { replaceString: replacement, nodeKeyOffsetList: offsets }
              )
            ).toBe(true);
          },
          { discrete: true }
        );
        editor.read(() => {
          expect($getRoot().getTextContent()).toBe(once ? first : all);
          expect($getRoot().getChildren()).toHaveLength(1);
          if (once) {
            const selection = $getSelection();
            expect(
              $isNodeSelection(selection) &&
                selection.getNodes().map((node) => node.getKey())
            ).toEqual([offsets[1].key]);
          }
        });
      }
    );
  });
}

it('replace-all preserves formatting when one match spans text-node boundaries', () => {
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
    () => {
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode('hel').setFormat('bold'),
          $createTextNode('lo tail')
        )
      );
      editor.dispatchCommand(DO_SEARCH_COMMAND, 'hello');
      expect(offsets.map((entry) => entry.offset.isReplace)).toEqual([
        true,
        false,
      ]);
      editor.dispatchCommand(DO_REPLACE_COMMAND, {
        replaceString: 'x',
        nodeKeyOffsetList: offsets,
      });
    },
    { discrete: true }
  );
  editor.read(() => {
    expect($getRoot().getTextContent()).toBe('x tail');
    expect(
      $getRoot()
        .getAllTextNodes()
        .map((node) => [node.getTextContent(), node.hasFormat('bold')])
    ).toEqual([
      ['x', true],
      [' tail', false],
    ]);
  });
});
