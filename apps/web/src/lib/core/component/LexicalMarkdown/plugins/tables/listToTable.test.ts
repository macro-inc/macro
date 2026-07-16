import {
  $createListItemNode,
  $createListNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
  type ListType,
} from '@lexical/list';
import { registerRichText } from '@lexical/rich-text';
import {
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  type TableNode,
} from '@lexical/table';
import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import {
  $getConvertibleListFromSelection,
  $listToGrid,
  LIST_TO_TABLE_COMMAND,
  registerListToTableCommand,
} from './listToTable';
import { tablePlugin } from './tablePlugin';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'list-to-table-test',
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  tablePlugin({
    hasCellMerge: true,
    hasCellBackgroundColor: true,
    hasTabHandler: true,
  })(editor);
  registerListToTableCommand(editor);
  registerRichText(editor);
  const rootElement = document.createElement('div');
  rootElement.contentEditable = 'true';
  document.body.appendChild(rootElement);
  editor.setRootElement(rootElement);
  return editor;
}

function $item(text: string): ListItemNode {
  const item = $createListItemNode();
  item.append($createTextNode(text));
  return item;
}

/** Wraps items in the tree-nesting shape: a wrapper item holding a sub-list. */
function $wrap(items: ListItemNode[], type: ListType = 'bullet'): ListItemNode {
  const wrapper = $createListItemNode();
  const sub = $createListNode(type);
  sub.append(...items);
  wrapper.append(sub);
  return wrapper;
}

/** Builds `- header / - rows...` columns as Lexical's list plugin nests them. */
function $buildColumns(
  columns: Array<[string, string[]]>,
  type: ListType = 'bullet'
): ListNode {
  const list = $createListNode(type);
  for (const [header, rows] of columns) {
    list.append($item(header));
    if (rows.length > 0) list.append($wrap(rows.map($item), type));
  }
  return list;
}

async function mount(editor: LexicalEditor, $build: () => ListNode) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        $getRoot().clear().append($build());
      },
      { onUpdate: () => resolve() }
    );
  });
}

function getListKey(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => {
    const list = $getRoot().getFirstChild();
    if (!$isListNode(list)) throw new Error('no list');
    return list.getKey();
  });
}

async function convert(editor: LexicalEditor): Promise<boolean> {
  const handled = editor.dispatchCommand(
    LIST_TO_TABLE_COMMAND,
    getListKey(editor)
  );
  await Promise.resolve();
  return handled;
}

function $getTable(): TableNode {
  const table = $getRoot().getFirstChild();
  if (!$isTableNode(table)) throw new Error('no table');
  return table;
}

function readCellTexts(editor: LexicalEditor): string[][] {
  return editor.getEditorState().read(() =>
    $getTable()
      .getChildren()
      .filter($isTableRowNode)
      .map((row) =>
        row
          .getChildren()
          .filter($isTableCellNode)
          .map((cell) => cell.getTextContent())
      )
  );
}

describe('list to table conversion', () => {
  it('turns top-level items into columns and nested items into rows', async () => {
    const editor = createTestEditor();
    await mount(editor, () =>
      $buildColumns([
        ['column 1', ['a1', 'a2', 'a3']],
        ['column 2', ['b1', 'b2', 'b3']],
        ['column 3', ['c1', 'c2', 'c3']],
      ])
    );

    expect(await convert(editor)).toBe(true);
    expect(readCellTexts(editor)).toEqual([
      ['column 1', 'column 2', 'column 3'],
      ['a1', 'b1', 'c1'],
      ['a2', 'b2', 'c2'],
      ['a3', 'b3', 'c3'],
    ]);
  });

  it('marks the first row as header cells', async () => {
    const editor = createTestEditor();
    await mount(editor, () =>
      $buildColumns([
        ['x', ['1']],
        ['y', ['2']],
      ])
    );
    await convert(editor);

    editor.getEditorState().read(() => {
      const [headerRow, bodyRow] = $getTable()
        .getChildren()
        .filter($isTableRowNode);
      for (const cell of headerRow.getChildren().filter($isTableCellNode)) {
        expect(cell.getHeaderStyles()).toBe(TableCellHeaderStates.ROW);
      }
      for (const cell of bodyRow.getChildren().filter($isTableCellNode)) {
        expect(cell.getHeaderStyles()).toBe(TableCellHeaderStates.NO_STATUS);
      }
    });
  });

  it('pads ragged columns with empty cells', async () => {
    const editor = createTestEditor();
    await mount(editor, () =>
      $buildColumns([
        ['column 1', ['a1', 'a2', 'a3']],
        ['column 2', ['b1']],
      ])
    );

    expect(await convert(editor)).toBe(true);
    expect(readCellTexts(editor)).toEqual([
      ['column 1', 'column 2'],
      ['a1', 'b1'],
      ['a2', ''],
      ['a3', ''],
    ]);
  });

  it('keeps content nested deeper than two levels as a list inside the cell', async () => {
    const editor = createTestEditor();
    await mount(editor, () => {
      const list = $createListNode('bullet');
      list.append($item('column 1'));
      const a1 = $item('a1');
      list.append($wrap([a1, $wrap([$item('deep 1'), $item('deep 2')])]));
      list.append($item('column 2'));
      list.append($wrap([$item('b1')]));
      return list;
    });

    expect(await convert(editor)).toBe(true);
    editor.getEditorState().read(() => {
      const bodyRow = $getTable().getChildren().filter($isTableRowNode)[1];
      const cell = bodyRow.getChildren().filter($isTableCellNode)[0];
      const [paragraph, nested] = cell.getChildren();
      expect(paragraph.getTextContent()).toBe('a1');
      expect($isListNode(nested)).toBe(true);
      expect(nested.getTextContent()).toContain('deep 1');
      expect(nested.getTextContent()).toContain('deep 2');
    });
  });

  it('preserves inline formatting when moving content into cells', async () => {
    const editor = createTestEditor();
    await mount(editor, () => {
      const list = $createListNode('bullet');
      const header = $createListItemNode();
      const bold = $createTextNode('column 1');
      bold.setFormat('bold');
      header.append(bold);
      list.append(header, $wrap([$item('a1')]));
      list.append($item('column 2'), $wrap([$item('b1')]));
      return list;
    });

    expect(await convert(editor)).toBe(true);
    editor.getEditorState().read(() => {
      const headerRow = $getTable().getChildren().filter($isTableRowNode)[0];
      const cell = headerRow.getChildren().filter($isTableCellNode)[0];
      const text = cell.getFirstDescendant();
      expect(text?.getTextContent()).toBe('column 1');
      expect($isTextNode(text) && text.hasFormat('bold')).toBe(true);
    });
  });

  it('rejects a flat list', async () => {
    const editor = createTestEditor();
    await mount(editor, () => {
      const list = $createListNode('bullet');
      list.append($item('one'), $item('two'), $item('three'));
      return list;
    });

    expect(await convert(editor)).toBe(false);
    editor.getEditorState().read(() => {
      expect($isListNode($getRoot().getFirstChild())).toBe(true);
    });
  });

  it('rejects a single-column list', async () => {
    const editor = createTestEditor();
    await mount(editor, () => $buildColumns([['column 1', ['a1', 'a2']]]));
    expect(await convert(editor)).toBe(false);
  });

  it('rejects a list where a top-level item has no nested content', async () => {
    const editor = createTestEditor();
    await mount(editor, () =>
      $buildColumns([
        ['column 1', ['a1']],
        ['column 2', []],
      ])
    );
    expect(await convert(editor)).toBe(false);
  });

  it('rejects checklists', async () => {
    const editor = createTestEditor();
    await mount(editor, () =>
      $buildColumns(
        [
          ['column 1', ['a1']],
          ['column 2', ['b1']],
        ],
        'check'
      )
    );
    expect(await convert(editor)).toBe(false);
  });

  it('handles nested lists embedded directly in their parent item', async () => {
    const editor = createTestEditor();
    await mount(editor, () => {
      const list = $createListNode('bullet');
      for (const [header, rows] of [
        ['column 1', ['a1', 'a2']],
        ['column 2', ['b1', 'b2']],
      ] as Array<[string, string[]]>) {
        const item = $item(header);
        const sub = $createListNode('bullet');
        sub.append(...rows.map($item));
        item.append(sub);
        list.append(item);
      }
      return list;
    });

    expect(await convert(editor)).toBe(true);
    expect(readCellTexts(editor)).toEqual([
      ['column 1', 'column 2'],
      ['a1', 'b1'],
      ['a2', 'b2'],
    ]);
  });

  it('finds the convertible list from a selection inside it, but not elsewhere', async () => {
    const editor = createTestEditor();
    await mount(editor, () =>
      $buildColumns([
        ['column 1', ['a1']],
        ['column 2', ['b1']],
      ])
    );
    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode('outside'));
          $getRoot().append(paragraph);
        },
        { onUpdate: () => resolve() }
      );
    });

    const $selectText = (content: string) => {
      const text = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === content);
      if (!text) throw new Error(`no text node "${content}"`);
      text.select(0, 0);
    };

    await new Promise<void>((resolve) => {
      editor.update(() => $selectText('a1'), { onUpdate: () => resolve() });
    });
    editor.getEditorState().read(() => {
      expect($getConvertibleListFromSelection()?.getKey()).toBe(
        $getRoot().getFirstChild()?.getKey()
      );
    });

    await new Promise<void>((resolve) => {
      editor.update(() => $selectText('outside'), {
        onUpdate: () => resolve(),
      });
    });
    editor.getEditorState().read(() => {
      expect($getConvertibleListFromSelection()).toBeNull();
    });
  });

  it('reads the grid without mutating the list', async () => {
    const editor = createTestEditor();
    await mount(editor, () =>
      $buildColumns([
        ['column 1', ['a1']],
        ['column 2', ['b1', 'b2']],
      ])
    );

    const shape = editor.getEditorState().read(() => {
      const list = $getRoot().getFirstChild();
      if (!$isListNode(list)) throw new Error('no list');
      const grid = $listToGrid(list);
      return grid?.map((column) => ({
        header: column.header.getTextContent(),
        cells: column.cells.map((cell) => cell.item.getTextContent()),
      }));
    });

    expect(shape).toEqual([
      { header: 'column 1', cells: ['a1'] },
      { header: 'column 2', cells: ['b1', 'b2'] },
    ]);
  });
});
