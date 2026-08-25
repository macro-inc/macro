import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
} from '@lexical/table';
import {
  $createCollapsibleSection,
  $isCollapsibleContainerNode,
} from '@macro-inc/lexical-core';
import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { tablePlugin } from '../tables/tablePlugin';
import {
  collapsiblePlugin,
  INSERT_COLLAPSIBLE_COMMAND,
} from './collapsiblePlugin';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'collapsible-table-cell-test',
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
  collapsiblePlugin()(editor);
  const rootElement = document.createElement('div');
  rootElement.contentEditable = 'true';
  document.body.appendChild(rootElement);
  editor.setRootElement(rootElement);
  return editor;
}

function $tableWithText(text: string) {
  const table = $createTableNode();
  const row = $createTableRowNode();
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(text));
  cell.append(paragraph);
  row.append(cell);
  table.append(row);
  return { table, paragraph };
}

describe('collapsible sections vs tables', () => {
  it('strips a collapsible section out of a table cell', async () => {
    const editor = createTestEditor();
    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const table = $createTableNode();
          const row = $createTableRowNode();
          const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
          const section = $createCollapsibleSection({ heading: 'h2' });
          section.getTitle()?.append($createTextNode('Nope'));
          cell.append(section);
          row.append(cell);
          table.append(row);
          $getRoot().clear().append(table);
        },
        { onUpdate: () => resolve() }
      );
    });

    editor.getEditorState().read(() => {
      const table = $getRoot().getFirstChild();
      expect($isTableNode(table)).toBe(true);
      if (!$isTableNode(table)) return;
      const row = table.getFirstChild();
      expect($isTableRowNode(row)).toBe(true);
      if (!$isTableRowNode(row)) return;
      const cell = row.getFirstChild();
      expect($isTableCellNode(cell)).toBe(true);
      if (!$isTableCellNode(cell)) return;
      expect(cell.getChildren().some($isCollapsibleContainerNode)).toBe(false);
    });
  });

  it('wraps a table in a collapsible when inserting a toggle from inside a cell', async () => {
    const editor = createTestEditor();
    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const { table, paragraph } = $tableWithText('Ada');
          $getRoot().clear().append(table);
          paragraph.selectStart();
        },
        { onUpdate: () => resolve() }
      );
    });

    editor.dispatchCommand(INSERT_COLLAPSIBLE_COMMAND, 'h2');
    await Promise.resolve();

    editor.getEditorState().read(() => {
      const container = $getRoot().getFirstChild();
      expect($isCollapsibleContainerNode(container)).toBe(true);
      if (!$isCollapsibleContainerNode(container)) return;
      expect(container.getTitle()?.getHeading()).toBe('h2');
      const child = container.getContent()?.getFirstChild();
      expect($isTableNode(child)).toBe(true);
      expect(child?.getTextContent()).toContain('Ada');
    });
  });
});
