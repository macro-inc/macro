import { $createTableSelection } from '@lexical/table';
import { $setSelection, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $deleteTableAtHover } from './tableDelete';
import {
  $getCell,
  $getTable,
  buildTable,
  createTableTestEditor,
  placeCaret,
  readCellTexts,
  textGrid,
} from './tableTestUtils';

function createTableEditor(): LexicalEditor {
  return createTableTestEditor();
}

const GRID = [
  ['01', '02', '03'],
  ['04', '05', '06'],
  ['07', '08', '09'],
];

async function selectCells(
  editor: LexicalEditor,
  from: [number, number],
  to: [number, number]
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
}

async function deleteAtHover(
  editor: LexicalEditor,
  cell: [number, number],
  type: 'row' | 'column' | 'table'
) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        $deleteTableAtHover($getCell(...cell), type);
      },
      { onUpdate: () => resolve() }
    );
  });
}

describe('$deleteTableAtHover', () => {
  it('deletes every selected row when the hovered cell is in that row range', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));
    await selectCells(editor, [0, 0], [1, 1]);
    await deleteAtHover(editor, [1, 0], 'row');

    expect(readCellTexts(editor)).toEqual([['07', '08', '09']]);
  });

  it('deletes selected rows when hovering a cell in those rows outside the selected columns', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));
    await selectCells(editor, [0, 0], [1, 0]);
    await deleteAtHover(editor, [0, 2], 'row');

    expect(readCellTexts(editor)).toEqual([['07', '08', '09']]);
  });

  it('deletes only the hovered row when it is outside the selection', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));
    await selectCells(editor, [0, 0], [0, 1]);
    await deleteAtHover(editor, [2, 0], 'row');

    expect(readCellTexts(editor)).toEqual([
      ['01', '02', '03'],
      ['04', '05', '06'],
    ]);
  });

  it('deletes a single row from a caret in the hovered cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));
    await placeCaret(editor, '04');
    await deleteAtHover(editor, [1, 0], 'row');

    expect(readCellTexts(editor)).toEqual([
      ['01', '02', '03'],
      ['07', '08', '09'],
    ]);
  });

  it('deletes every selected column when the hovered cell is in that column range', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));
    await selectCells(editor, [0, 0], [1, 1]);
    await deleteAtHover(editor, [0, 1], 'column');

    expect(readCellTexts(editor)).toEqual([['03'], ['06'], ['09']]);
  });

  it('deletes only the hovered column when it is outside the selection', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid(GRID));
    await selectCells(editor, [0, 0], [1, 0]);
    await deleteAtHover(editor, [0, 2], 'column');

    expect(readCellTexts(editor)).toEqual([
      ['01', '02'],
      ['04', '05'],
      ['07', '08'],
    ]);
  });
});
