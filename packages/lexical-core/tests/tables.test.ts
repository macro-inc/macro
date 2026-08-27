import { $isListItemNode, $isListNode, type ListNode } from '@lexical/list';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  type TableCellNode,
  type TableNode,
  type TableRowNode,
} from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $createImageNode, $isImageNode } from '../nodes/ImageNode';
import { $createVideoNode, $isVideoNode } from '../nodes/VideoNode';
import { EXTERNAL_TRANSFORMERS, INTERNAL_TRANSFORMERS } from '../transformers';

function createTestEditor() {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
}

function $createCell(
  text: string,
  headerState: number = TableCellHeaderStates.NO_STATUS
): TableCellNode {
  const cell = $createTableCellNode(headerState);
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(text));
  cell.append(paragraph);
  return cell;
}

async function buildEditorState(
  editor: ReturnType<typeof createEditor>,
  $build: () => void
) {
  await new Promise<void>((resolve) => {
    editor.update($build, { onUpdate: () => resolve() });
  });
}

function exportMarkdown(
  editor: ReturnType<typeof createEditor>,
  transformers = INTERNAL_TRANSFORMERS
): string {
  let markdown = '';
  editor.getEditorState().read(() => {
    markdown = $convertToMarkdownString(transformers);
  });
  return markdown;
}

async function importMarkdown(
  editor: ReturnType<typeof createEditor>,
  markdown: string
) {
  await buildEditorState(editor, () => {
    $getRoot().clear();
    $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS);
  });
}

function $getFirstTable(): TableNode {
  const table = $getRoot()
    .getChildren()
    .find((child) => $isTableNode(child));
  expect(table).toBeDefined();
  return table as TableNode;
}

describe('m-table internal transformer', () => {
  it('round-trips colspan, rowspan, header state, col widths and row height', async () => {
    const editor = createTestEditor();

    await buildEditorState(editor, () => {
      const table = $createTableNode();
      table.setColWidths([120, 240, 360]);

      const headerRow = $createTableRowNode();
      headerRow.append(
        $createCell('Name', TableCellHeaderStates.ROW),
        $createCell('Role', TableCellHeaderStates.ROW),
        $createCell('Team', TableCellHeaderStates.ROW)
      );

      const mergedRow = $createTableRowNode();
      mergedRow.setHeight(48);
      const mergedCell = $createCell('Wolf');
      mergedCell.setColSpan(2);
      mergedCell.setRowSpan(2);
      mergedRow.append(mergedCell, $createCell('Eng'));

      const lastRow = $createTableRowNode();
      lastRow.append($createCell('Design'));

      table.append(headerRow, mergedRow, lastRow);
      $getRoot().append(table);
    });

    const markdown = exportMarkdown(editor);
    expect(markdown).toContain('<m-table col-widths="120,240,360">');
    expect(markdown).toContain('<m-table-row height="48">');
    expect(markdown).toContain('<m-table-cell colspan="2" rowspan="2">Wolf');
    expect(markdown).toContain('<m-table-cell header="row">Name');

    await importMarkdown(editor, markdown);

    editor.getEditorState().read(() => {
      const table = $getFirstTable();
      expect(table.getColWidths()).toEqual([120, 240, 360]);

      const rows = table.getChildren().filter($isTableRowNode);
      expect(rows).toHaveLength(3);
      expect((rows[1] as TableRowNode).getHeight()).toBe(48);

      const headerCells = (rows[0] as TableRowNode)
        .getChildren()
        .filter($isTableCellNode);
      for (const cell of headerCells) {
        expect(cell.__headerState).toBe(TableCellHeaderStates.ROW);
      }

      const [mergedCell] = (rows[1] as TableRowNode)
        .getChildren()
        .filter($isTableCellNode);
      expect(mergedCell.getColSpan()).toBe(2);
      expect(mergedCell.getRowSpan()).toBe(2);
      expect(mergedCell.getTextContent()).toBe('Wolf');
    });
  });

  it('serializes height only on rows that have one', async () => {
    const editor = createTestEditor();

    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const autoRow = $createTableRowNode();
      autoRow.append($createCell('a'));
      const tallRow = $createTableRowNode();
      tallRow.setHeight(48);
      tallRow.append($createCell('b'));
      table.append(autoRow, tallRow);
      $getRoot().append(table);
    });

    expect(exportMarkdown(editor)).toBe(
      '<m-table><m-table-row><m-table-cell>a</m-table-cell></m-table-row><m-table-row height="48"><m-table-cell>b</m-table-cell></m-table-row></m-table>'
    );

    await importMarkdown(editor, exportMarkdown(editor));
    editor.getEditorState().read(() => {
      const rows = $getFirstTable().getChildren().filter($isTableRowNode);
      expect((rows[0] as TableRowNode).getHeight()).toBeUndefined();
      expect((rows[1] as TableRowNode).getHeight()).toBe(48);
    });
  });

  it('serializes plain tables without attributes, identical to the legacy format', async () => {
    const editor = createTestEditor();

    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      row.append($createCell('a'), $createCell('b'));
      table.append(row);
      $getRoot().append(table);
    });

    expect(exportMarkdown(editor)).toBe(
      '<m-table><m-table-row><m-table-cell>a</m-table-cell><m-table-cell>b</m-table-cell></m-table-row></m-table>'
    );
  });

  it('imports legacy attribute-less markup', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '<m-table><m-table-row><m-table-cell>a</m-table-cell><m-table-cell>b\\nc</m-table-cell></m-table-row></m-table>'
    );

    editor.getEditorState().read(() => {
      const table = $getFirstTable();
      const [row] = table.getChildren().filter($isTableRowNode);
      const cells = (row as TableRowNode)
        .getChildren()
        .filter($isTableCellNode);
      expect(cells).toHaveLength(2);
      expect(cells[0].getColSpan()).toBe(1);
      expect(cells[0].getRowSpan()).toBe(1);
      expect(cells[0].__headerState).toBe(TableCellHeaderStates.NO_STATUS);
      expect(cells[0].getTextContent()).toBe('a');
    });
  });

  it('ignores malformed attribute values', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '<m-table col-widths="abc,def"><m-table-row height="-5"><m-table-cell colspan="0" rowspan="x" header="nope">a</m-table-cell></m-table-row></m-table>'
    );

    editor.getEditorState().read(() => {
      const table = $getFirstTable();
      expect(table.getColWidths()).toBeUndefined();
      const [row] = table.getChildren().filter($isTableRowNode);
      expect((row as TableRowNode).getHeight()).toBeUndefined();
      const [cell] = (row as TableRowNode)
        .getChildren()
        .filter($isTableCellNode);
      expect(cell.getColSpan()).toBe(1);
      expect(cell.getRowSpan()).toBe(1);
      expect(cell.__headerState).toBe(TableCellHeaderStates.NO_STATUS);
    });
  });
});

describe('lists inside table cells', () => {
  function $getFirstCellList(): ListNode {
    const table = $getFirstTable();
    const [row] = table.getChildren().filter($isTableRowNode);
    const [cell] = (row as TableRowNode).getChildren().filter($isTableCellNode);
    const list = cell.getChildren().find($isListNode);
    expect(list).toBeDefined();
    return list as ListNode;
  }

  it('round-trips a bullet list in a cell through internal markdown', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '<m-table><m-table-row><m-table-cell>- one\\n- two</m-table-cell></m-table-row></m-table>'
    );

    const markdown = exportMarkdown(editor);
    expect(markdown).toBe(
      '<m-table><m-table-row><m-table-cell>- one\\n- two</m-table-cell></m-table-row></m-table>'
    );

    await importMarkdown(editor, markdown);
    editor.getEditorState().read(() => {
      const items = $getFirstCellList().getChildren().filter($isListItemNode);
      expect(items).toHaveLength(2);
      expect(items[0].getTextContent()).toBe('one');
      expect(items[1].getTextContent()).toBe('two');
    });
  });

  it('round-trips a nested list in a cell', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '<m-table><m-table-row><m-table-cell>- one\\n    - nested\\n- two</m-table-cell></m-table-row></m-table>'
    );

    await importMarkdown(editor, exportMarkdown(editor));
    editor.getEditorState().read(() => {
      const list = $getFirstCellList();
      expect(list.getTextContent()).toContain('nested');
      // The nested item lives in a child list, one level down
      const wrapper = list
        .getChildren()
        .filter($isListItemNode)
        .find((item) => item.getChildren().some($isListNode));
      expect(wrapper).toBeDefined();
    });
  });

  it('round-trips a checklist in a cell', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '<m-table><m-table-row><m-table-cell>- [ ] todo\\n- [x] done</m-table-cell></m-table-row></m-table>'
    );

    await importMarkdown(editor, exportMarkdown(editor));
    editor.getEditorState().read(() => {
      const list = $getFirstCellList();
      expect(list.getListType()).toBe('check');
      const items = list.getChildren().filter($isListItemNode);
      expect(items).toHaveLength(2);
      expect(items[0].getChecked()).toBeFalsy();
      expect(items[1].getChecked()).toBe(true);
    });
  });

  it('round-trips a list in a cell through external pipe-table markdown', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '<m-table><m-table-row><m-table-cell>- one\\n- two</m-table-cell><m-table-cell>plain</m-table-cell></m-table-row></m-table>'
    );

    const markdown = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);
    expect(markdown).toBe('| - one\\n- two | plain |');

    await buildEditorState(editor, () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, EXTERNAL_TRANSFORMERS);
    });
    editor.getEditorState().read(() => {
      const items = $getFirstCellList().getChildren().filter($isListItemNode);
      expect(items).toHaveLength(2);
    });
  });
});

describe('images inside table cells', () => {
  function $getFirstCellImage() {
    const table = $getFirstTable();
    const [row] = table.getChildren().filter($isTableRowNode);
    const [cell] = (row as TableRowNode).getChildren().filter($isTableCellNode);
    const image = cell
      .getChildren()
      .flatMap((child) =>
        $isImageNode(child)
          ? [child]
          : $isElementNode(child)
            ? child.getChildren().filter($isImageNode)
            : []
      )[0];
    expect(image).toBeDefined();
    return image!;
  }

  it('round-trips a markdown image in a cell through internal markdown', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '<m-table><m-table-row><m-table-cell>![cat](https://example.com/cat.png)</m-table-cell></m-table-row></m-table>'
    );

    const markdown = exportMarkdown(editor);
    expect(markdown).toBe(
      '<m-table><m-table-row><m-table-cell>![cat](https://example.com/cat.png)</m-table-cell></m-table-row></m-table>'
    );

    await importMarkdown(editor, markdown);
    editor.getEditorState().read(() => {
      const image = $getFirstCellImage();
      expect(image.getUrl()).toBe('https://example.com/cat.png');
      expect(image.getAlt()).toBe('cat');
    });
  });

  it('round-trips a constrained image in a cell', async () => {
    const editor = createTestEditor();

    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
      cell.append(
        $createImageNode({
          srcType: 'url',
          url: 'https://example.com/cat.png',
          alt: 'cat',
          width: 400,
          height: 300,
          constrainedWidth: 200,
          constrainedHeight: 150,
        })
      );
      row.append(cell);
      table.append(row);
      $getRoot().append(table);
    });

    const markdown = exportMarkdown(editor);
    expect(markdown).toContain('<m-image>');
    expect(markdown).toContain('"constrainedWidth":200');
    expect(markdown).toContain('"constrainedHeight":150');

    await importMarkdown(editor, markdown);
    editor.getEditorState().read(() => {
      const image = $getFirstCellImage();
      expect(image.getUrl()).toBe('https://example.com/cat.png');
      expect(image.getAlt()).toBe('cat');
      expect(image.getConstrainedWidth()).toBe(200);
      expect(image.getConstrainedHeight()).toBe(150);
    });
  });

  it('round-trips a markdown image in a cell through external pipe-table markdown', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '<m-table><m-table-row><m-table-cell>![cat](https://example.com/cat.png)</m-table-cell><m-table-cell>plain</m-table-cell></m-table-row></m-table>'
    );

    const markdown = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);
    expect(markdown).toBe('| ![cat](https://example.com/cat.png) | plain |');

    await buildEditorState(editor, () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, EXTERNAL_TRANSFORMERS);
    });
    editor.getEditorState().read(() => {
      const image = $getFirstCellImage();
      expect(image.getUrl()).toBe('https://example.com/cat.png');
      expect(image.getAlt()).toBe('cat');
    });
  });
});

describe('videos inside table cells', () => {
  function $getFirstCellVideo() {
    const table = $getFirstTable();
    const [row] = table.getChildren().filter($isTableRowNode);
    const [cell] = (row as TableRowNode).getChildren().filter($isTableCellNode);
    const video = cell
      .getChildren()
      .flatMap((child) =>
        $isVideoNode(child)
          ? [child]
          : $isElementNode(child)
            ? child.getChildren().filter($isVideoNode)
            : []
      )[0];
    expect(video).toBeDefined();
    return video!;
  }

  it('round-trips a video in a cell through internal markdown', async () => {
    const editor = createTestEditor();

    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
      cell.append(
        $createVideoNode({
          srcType: 'url',
          url: 'https://example.com/clip.mp4',
          width: 400,
          height: 300,
          constrainedWidth: 200,
          constrainedHeight: 150,
        })
      );
      row.append(cell);
      table.append(row);
      $getRoot().append(table);
    });

    const markdown = exportMarkdown(editor);
    expect(markdown).toContain('<m-video>');
    expect(markdown).toContain('https://example.com/clip.mp4');
    expect(markdown).toContain('"constrainedWidth":200');

    await importMarkdown(editor, markdown);
    editor.getEditorState().read(() => {
      const video = $getFirstCellVideo();
      expect(video.getUrl()).toBe('https://example.com/clip.mp4');
      expect(video.getConstrainedWidth()).toBe(200);
      expect(video.getConstrainedHeight()).toBe(150);
    });
  });

  it('round-trips a video in a cell through external pipe-table markdown', async () => {
    const editor = createTestEditor();

    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      const videoCell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
      videoCell.append(
        $createVideoNode({
          srcType: 'url',
          url: 'https://example.com/clip.mp4',
        })
      );
      row.append(videoCell, $createCell('plain'));
      table.append(row);
      $getRoot().append(table);
    });

    const markdown = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);
    expect(markdown).toContain('<m-video>');
    expect(markdown).toContain('|');
    expect(markdown).toContain('plain');

    await buildEditorState(editor, () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, EXTERNAL_TRANSFORMERS);
    });
    editor.getEditorState().read(() => {
      const video = $getFirstCellVideo();
      expect(video.getUrl()).toBe('https://example.com/clip.mp4');
    });
  });
});

describe('pipe table external transformer', () => {
  it('pads merged cells so exported rows stay rectangular', async () => {
    const editor = createTestEditor();

    await buildEditorState(editor, () => {
      const table = $createTableNode();

      const firstRow = $createTableRowNode();
      const wideCell = $createCell('wide');
      wideCell.setColSpan(2);
      firstRow.append(wideCell, $createCell('c'));

      const secondRow = $createTableRowNode();
      secondRow.append($createCell('x'), $createCell('y'), $createCell('z'));

      table.append(firstRow, secondRow);
      $getRoot().append(table);
    });

    const markdown = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);
    const lines = markdown.split('\n');
    expect(lines[0]).toBe('| wide |  | c |');
    expect(lines[1]).toBe('| x | y | z |');
  });
});
