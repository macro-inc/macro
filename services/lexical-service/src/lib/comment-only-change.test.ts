import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import { $wrapSelectionInMarkNode } from '@lexical/mark';
import { CommentNode } from '@macro-inc/lexical-core';
import {
  $createRangeSelection,
  $getRoot,
  $isElementNode,
  $isTextNode,
  type SerializedEditorState,
} from 'lexical';
import { isCommentOnlyChange } from './comment-only-change';
import { createEditor } from './editor';

const before = {
  root: {
    $: { id: 'root-1' },
    type: 'root',
    version: 1,
    format: '',
    indent: 0,
    direction: null,
    children: [
      {
        $: { id: 'para-1', peerId: 'author' },
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        textFormat: 0,
        textStyle: '',
        children: [
          {
            $: { id: 'text-1', peerId: 'author' },
            type: 'text',
            version: 1,
            text: 'The second stage backfills the ledger from the archive.',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
      {
        $: { id: 'para-2', peerId: 'author' },
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        textFormat: 0,
        textStyle: '',
        children: [
          {
            $: { id: 'text-2', peerId: 'author' },
            type: 'text',
            version: 1,
            text: 'Run it twice.',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
    ],
  },
} as unknown as SerializedEditorState;

/** `before` with "backfills the ledger" under a comment mark, as a commenter's client writes it. */
const commented = {
  root: {
    $: { id: 'root-1' },
    type: 'root',
    version: 1,
    format: '',
    indent: 0,
    direction: null,
    children: [
      {
        $: { id: 'para-1', peerId: 'author' },
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        textFormat: 0,
        textStyle: '',
        children: [
          {
            $: { id: 'text-1', peerId: 'author' },
            type: 'text',
            version: 1,
            text: 'The second stage ',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
          {
            $: { id: 'mark-node-1', peerId: 'commenter' },
            type: 'comment-mark',
            version: 1,
            format: '',
            indent: 0,
            direction: null,
            ids: ['mark-1'],
            isDraft: false,
            children: [
              {
                $: { id: 'text-3', peerId: 'commenter' },
                type: 'text',
                version: 1,
                text: 'backfills the ledger',
                format: 0,
                detail: 0,
                mode: 'normal',
                style: '',
              },
            ],
          },
          {
            $: { id: 'text-4', peerId: 'commenter' },
            type: 'text',
            version: 1,
            text: ' from the archive.',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
      {
        $: { id: 'para-2', peerId: 'author' },
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        textFormat: 0,
        textStyle: '',
        children: [
          {
            $: { id: 'text-2', peerId: 'author' },
            type: 'text',
            version: 1,
            text: 'Run it twice.',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
    ],
  },
} as unknown as SerializedEditorState;

/** `commented` changed by `edit`, so each case states only what it alters. */
function changed(
  edit: (root: any) => void,
  state: SerializedEditorState = commented
): SerializedEditorState {
  const copy = structuredClone(state);
  edit(copy.root);
  return copy;
}

describe('isCommentOnlyChange', () => {
  it('accepts wrapping text in a comment mark', () => {
    expect(isCommentOnlyChange(before, commented)).toBe(true);
  });

  it('accepts removing a comment mark', () => {
    expect(isCommentOnlyChange(commented, before)).toBe(true);
  });

  it('accepts changing a mark itself', () => {
    const resolved = changed((root) => {
      const mark = root.children[0].children[1];
      mark.ids = ['mark-1', 'mark-2'];
      mark.$.sharedPeerIds = ['someone-else'];
    });
    expect(isCommentOnlyChange(commented, resolved)).toBe(true);
  });

  it('accepts a mark next to text already stored in pieces', () => {
    const storedInPieces = changed((root) => {
      root.children[0].children = [
        { ...root.children[0].children[0], text: 'The second ' },
        {
          ...root.children[0].children[0],
          $: { id: 'text-5' },
          text: 'stage ',
        },
        ...root.children[0].children.slice(1),
      ];
    });
    const unmarked = changed((root) => {
      const [first, second, mark, last] = root.children[0].children;
      root.children[0].children = [first, second, mark.children[0], last];
    }, storedInPieces);
    expect(isCommentOnlyChange(unmarked, storedInPieces)).toBe(true);
  });

  it('accepts a mark made by Lexical itself', () => {
    const editor = createEditor();
    editor.setEditorState(editor.parseEditorState(before));
    editor.update(
      () => {
        const text = $getRoot().getFirstChildOrThrow();
        if (!$isElementNode(text)) throw new Error('expected a paragraph');
        const node = text.getFirstChildOrThrow();
        if (!$isTextNode(node)) throw new Error('expected text');
        const selection = $createRangeSelection();
        selection.anchor.set(node.getKey(), 17, 'text');
        selection.focus.set(node.getKey(), 37, 'text');
        $wrapSelectionInMarkNode(
          selection,
          false,
          'mark-1',
          (ids) => new CommentNode(ids, undefined, -1, true)
        );
      },
      { discrete: true }
    );
    const after = editor.getEditorState().toJSON();
    expect(JSON.stringify(after)).toContain('comment-mark');
    expect(isCommentOnlyChange(before, after)).toBe(true);
  });

  it('rejects inserting text inside a mark', () => {
    const edited = changed((root) => {
      root.children[0].children[1].children[0].text = 'deletes the ledger';
    });
    expect(isCommentOnlyChange(commented, edited)).toBe(false);
  });

  it('rejects editing text while adding a mark', () => {
    const edited = changed((root) => {
      root.children[1].children[0].text = 'Run it once.';
    });
    expect(isCommentOnlyChange(before, edited)).toBe(false);
  });

  it('rejects formatting text', () => {
    const bold = changed((root) => {
      root.children[0].children[1].children[0].format = 1;
    });
    expect(isCommentOnlyChange(commented, bold)).toBe(false);
  });

  it('rejects reordering blocks', () => {
    const reordered = changed((root) => {
      root.children.reverse();
    }, before);
    expect(isCommentOnlyChange(before, reordered)).toBe(false);
  });

  it('rejects removing a block', () => {
    const removed = changed((root) => {
      root.children.pop();
    }, before);
    expect(isCommentOnlyChange(before, removed)).toBe(false);
  });

  it('rejects changing node state that is not identity', () => {
    const pinned = changed((root) => {
      root.$.pinnedPropertyIds = ['property-1'];
    }, before);
    expect(isCommentOnlyChange(before, pinned)).toBe(false);
  });

  it('throws on a state that does not parse', () => {
    const unknown = changed((root) => {
      root.children[0].type = 'not-a-node';
    }, before);
    expect(() => isCommentOnlyChange(before, unknown)).toThrow();
  });
});
