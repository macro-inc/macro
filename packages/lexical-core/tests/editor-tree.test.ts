import { $createListItemNode, $createListNode } from '@lexical/list';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  TableCellHeaderStates,
} from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $assertValidEditorTree,
  $salvageTableCellChildren,
  validateEditorTree,
} from '../utils/editor-tree';

function createTestEditor() {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
}

function $headerCell(text: string) {
  const cell = $createTableCellNode(TableCellHeaderStates.ROW);
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(text));
  cell.append(paragraph);
  return cell;
}

function $bodyCell(text: string) {
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(text));
  cell.append(paragraph);
  return cell;
}

describe('validateEditorTree', () => {
  it('accepts a well-formed table', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const table = $createTableNode();
        const header = $createTableRowNode();
        header.append($headerCell('H'));
        const body = $createTableRowNode();
        body.append($bodyCell('a'));
        table.append(header, body);
        $getRoot().clear().append($createParagraphNode(), table);
        expect(validateEditorTree($getRoot())).toEqual([]);
      },
      { discrete: true }
    );
  });

  it('rejects a bare text child of a table cell', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const table = $createTableNode();
        const row = $createTableRowNode();
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
        cell.append($createTextNode('orphan'));
        row.append(cell);
        table.append(row);
        $getRoot().clear().append(table);
        const issues = validateEditorTree($getRoot());
        expect(issues.map((issue) => issue.message)).toEqual([
          'tablecell child must be a content block, got text',
        ]);
        expect(() => $assertValidEditorTree($getRoot())).toThrow(
          /invalid editor tree/
        );
      },
      { discrete: true }
    );
  });

  it('rejects a paragraph sitting in a table row', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const table = $createTableNode();
        const row = $createTableRowNode();
        row.append($createParagraphNode());
        table.append(row);
        $getRoot().clear().append(table);
        expect(validateEditorTree($getRoot())[0]?.message).toMatch(
          /tablerow child must be tablecell/
        );
      },
      { discrete: true }
    );
  });

  it('accepts a list of list items', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const list = $createListNode('bullet');
        const item = $createListItemNode();
        item.append($createTextNode('ok'));
        list.append(item);
        $getRoot().clear().append(list);
        expect(validateEditorTree($getRoot())).toEqual([]);
      },
      { discrete: true }
    );
  });

  it('rejects a table cell sitting on the root', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        $getRoot().clear().append($bodyCell('stray'));
        expect(validateEditorTree($getRoot())[0]?.message).toMatch(
          /tablecell must be nested under its table parent/
        );
      },
      { discrete: true }
    );
  });
});

describe('$salvageTableCellChildren', () => {
  it('wraps a stray text node in a paragraph and keeps the text', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
        cell.append($createTextNode('kept'));
        const result = $salvageTableCellChildren(cell);
        expect(result.salvagedTypes).toEqual(['text']);
        expect(result.removedTypes).toEqual([]);
        expect(cell.getChildren().map((child) => child.getType())).toEqual([
          'paragraph',
        ]);
        expect(cell.getTextContent()).toBe('kept');
      },
      { discrete: true }
    );
  });

  it('drops a nested table instead of wrapping it', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
        cell.append($createParagraphNode());
        const nested = $createTableNode();
        const row = $createTableRowNode();
        row.append($bodyCell('inner'));
        nested.append(row);
        cell.append(nested);
        const result = $salvageTableCellChildren(cell);
        expect(result.removedTypes).toEqual(['table']);
        expect(cell.getChildren().some($isTableCellNode)).toBe(false);
        expect(cell.getChildren().map((child) => child.getType())).toEqual([
          'paragraph',
        ]);
      },
      { discrete: true }
    );
  });
});
