import { $createTableSelection } from '@lexical/table';
import {
  $isParagraphNode,
  $setSelection,
  CUT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';

// markdownPastePlugin (pulled in transitively) only needs this for plain-text
// pastes, which these tests never exercise.
vi.mock('../../utils', () => ({
  setEditorStateFromMarkdown: vi.fn(),
}));

import {
  $getCell,
  $getTable,
  buildTable,
  createTableTestEditor,
  readCellTexts,
  textGrid,
} from './tableTestUtils';

// jsdom implements neither ClipboardEvent nor execCommand; the cut path only
// needs `instanceof ClipboardEvent` checks to fail so it takes the null branch.
if (typeof globalThis.ClipboardEvent === 'undefined') {
  class PolyfillClipboardEvent extends Event {
    clipboardData: DataTransfer | null = null;
  }
  globalThis.ClipboardEvent =
    PolyfillClipboardEvent as unknown as typeof ClipboardEvent;
}
if (typeof document.execCommand !== 'function') {
  document.execCommand = () => true;
}

function createTableEditor(): LexicalEditor {
  return createTableTestEditor();
}

/** Selects the rectangle of cells and dispatches `command`. */
async function selectAndDispatch(
  editor: LexicalEditor,
  from: [number, number],
  to: [number, number],
  command: LexicalCommand<unknown>,
  payload: unknown
) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const selection = $createTableSelection();
        selection.set(
          $getTable().getKey(),
          $getCell(...from).getKey(),
          $getCell(...to).getKey()
        );
        $setSelection(selection);
      },
      { onUpdate: () => resolve() }
    );
  });
  editor.dispatchCommand(command, payload);
  await Promise.resolve();
}

const GRID = [
  ['01', '02', '03'],
  ['04', '05', '06'],
  ['07', '08', '09'],
];

describe('table cell clearing', () => {
  it('clears the selected cells on cut', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));

    await selectAndDispatch(
      editor,
      [0, 0],
      [1, 1],
      CUT_COMMAND as LexicalCommand<unknown>,
      null
    );

    expect(readCellTexts(editor)).toEqual([
      ['', '', '03'],
      ['', '', '06'],
      ['07', '08', '09'],
    ]);
  });

  it('clears the selected cells on Delete', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));

    await selectAndDispatch(
      editor,
      [0, 0],
      [0, 2],
      KEY_DELETE_COMMAND as LexicalCommand<unknown>,
      null
    );

    expect(readCellTexts(editor)).toEqual([
      ['', '', ''],
      ['04', '05', '06'],
      ['07', '08', '09'],
    ]);
  });

  it('clears the selected cells on Backspace', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));

    await selectAndDispatch(
      editor,
      [2, 0],
      [2, 2],
      KEY_BACKSPACE_COMMAND as LexicalCommand<unknown>,
      null
    );

    expect(readCellTexts(editor)).toEqual([
      ['01', '02', '03'],
      ['04', '05', '06'],
      ['', '', ''],
    ]);
  });

  it('leaves each cleared cell with a childless paragraph (no empty TextNode)', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));

    await selectAndDispatch(
      editor,
      [0, 0],
      [0, 0],
      KEY_DELETE_COMMAND as LexicalCommand<unknown>,
      null
    );

    editor.getEditorState().read(() => {
      const children = $getCell(0, 0).getChildren();
      expect(children).toHaveLength(1);
      const paragraph = children[0];
      if (!$isParagraphNode(paragraph)) throw new Error('not a paragraph');
      // The crash we're guarding against comes from an empty TextNode that the
      // text normalizer tries to remove — so there must be none here.
      expect(paragraph.getChildrenSize()).toBe(0);
    });
  });
});
