import { $isLinkNode } from '@lexical/link';
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
  $isTextNode,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $createDateMentionNode,
  $isDateMentionNode,
} from '../nodes/DateMentionNode';
import { $isEquationNode } from '../nodes/EquationNode';
import { $isGroupMentionNode } from '../nodes/GroupMentionNode';
import { $createImageNode, $isImageNode } from '../nodes/ImageNode';
import { $isUserMentionNode } from '../nodes/UserMentionNode';
import { $createVideoNode, $isVideoNode } from '../nodes/VideoNode';
import {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from '../transformers';
import { E_TABLE_NODE, isolatePipeTables } from '../transformers/tables';

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

  it('ignores spans beyond the safe integer range', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '<m-table><m-table-row><m-table-cell colspan="1e300" rowspan="9007199254740993">a</m-table-cell></m-table-row></m-table>'
    );

    editor.getEditorState().read(() => {
      const [row] = $getFirstTable().getChildren().filter($isTableRowNode);
      const [cell] = (row as TableRowNode)
        .getChildren()
        .filter($isTableCellNode);
      expect(cell.getColSpan()).toBe(1);
      expect(cell.getRowSpan()).toBe(1);
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
    expect(markdown).toBe('| - one\\n- two | plain |\n| --- | --- |');

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

describe('date mentions inside table cells', () => {
  const DATE_MENTION_MARKDOWN =
    '<m-date-mention>{"date":"2026-03-24T00:00:00.000Z","displayFormat":"March 24, 2026"}</m-date-mention>';

  function $getFirstCellDateMention() {
    const table = $getFirstTable();
    const [row] = table.getChildren().filter($isTableRowNode);
    const [cell] = (row as TableRowNode).getChildren().filter($isTableCellNode);
    const mention = cell
      .getChildren()
      .flatMap((child) =>
        $isDateMentionNode(child)
          ? [child]
          : $isElementNode(child)
            ? child.getChildren().filter($isDateMentionNode)
            : []
      )[0];
    expect(mention).toBeDefined();
    return mention!;
  }

  it('round-trips a date mention in a cell through internal markdown', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      `<m-table><m-table-row><m-table-cell>Due ${DATE_MENTION_MARKDOWN}</m-table-cell></m-table-row></m-table>`
    );

    const markdown = exportMarkdown(editor);
    expect(markdown).toContain(DATE_MENTION_MARKDOWN);

    await importMarkdown(editor, markdown);
    editor.getEditorState().read(() => {
      const mention = $getFirstCellDateMention();
      expect(mention.getDate()).toBe('2026-03-24T00:00:00.000Z');
      expect(mention.getDisplayFormat()).toBe('March 24, 2026');
    });
  });

  it('round-trips a date mention appended to a cell', async () => {
    const editor = createTestEditor();

    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
      const paragraph = $createParagraphNode();
      paragraph.append(
        $createTextNode('Due '),
        $createDateMentionNode({
          date: '2026-03-24T00:00:00.000Z',
          displayFormat: 'March 24, 2026',
        })
      );
      cell.append(paragraph);
      row.append(cell);
      table.append(row);
      $getRoot().append(table);
    });

    const markdown = exportMarkdown(editor);
    expect(markdown).toContain(DATE_MENTION_MARKDOWN);

    await importMarkdown(editor, markdown);
    editor.getEditorState().read(() => {
      const mention = $getFirstCellDateMention();
      expect(mention.getDate()).toBe('2026-03-24T00:00:00.000Z');
      expect(mention.getDisplayFormat()).toBe('March 24, 2026');
    });
  });

  it('round-trips a date mention in a cell through external pipe-table markdown', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      `<m-table><m-table-row><m-table-cell>Due ${DATE_MENTION_MARKDOWN}</m-table-cell><m-table-cell>plain</m-table-cell></m-table-row></m-table>`
    );

    const markdown = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);
    expect(markdown).toContain(DATE_MENTION_MARKDOWN);
    expect(markdown).toContain('|');
    expect(markdown).toContain('plain');

    await buildEditorState(editor, () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, EXTERNAL_TRANSFORMERS);
    });
    editor.getEditorState().read(() => {
      const mention = $getFirstCellDateMention();
      expect(mention.getDate()).toBe('2026-03-24T00:00:00.000Z');
      expect(mention.getDisplayFormat()).toBe('March 24, 2026');
    });
  });

  it('imports an internal date mention tag from a pipe-table cell', async () => {
    const editor = createTestEditor();

    await buildEditorState(editor, () => {
      $getRoot().clear();
      $convertFromMarkdownString(
        `| Due ${DATE_MENTION_MARKDOWN} | plain |`,
        EXTERNAL_TRANSFORMERS
      );
    });

    editor.getEditorState().read(() => {
      const mention = $getFirstCellDateMention();
      expect(mention.getDate()).toBe('2026-03-24T00:00:00.000Z');
      expect(mention.getDisplayFormat()).toBe('March 24, 2026');
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
    expect(markdown).toBe(
      '| ![cat](https://example.com/cat.png) | plain |\n| --- | --- |'
    );

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
    expect(lines).toEqual([
      '| wide |  | c |',
      '| --- | --- | --- |',
      '| x | y | z |',
    ]);
  });
});

describe('pipe characters inside pipe-table cells', () => {
  const GAB_MENTION =
    '<m-user-mention>{"userId":"macro|gab@macro.com","email":"gab@macro.com"}</m-user-mention>';

  async function importWith(
    editor: ReturnType<typeof createEditor>,
    markdown: string,
    transformers = EXTERNAL_TRANSFORMERS
  ) {
    await buildEditorState(editor, () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, transformers);
    });
  }

  function $cellGrid(): TableCellNode[][] {
    return $getFirstTable()
      .getChildren()
      .filter($isTableRowNode)
      .map((row) => row.getChildren().filter($isTableCellNode));
  }

  function $cellTexts(): string[][] {
    return $cellGrid().map((row) =>
      row.map((cell) => cell.getTextContent().trim())
    );
  }

  function $inlineNodes(cell: TableCellNode) {
    return cell
      .getChildren()
      .flatMap((child) => ($isElementNode(child) ? child.getChildren() : []));
  }

  for (const [name, transformers] of [
    ['external', EXTERNAL_TRANSFORMERS],
    ['all (static renderers)', ALL_TRANSFORMERS],
  ] as const) {
    it(`keeps a macro| user mention in one cell as a mention node (${name})`, async () => {
      const editor = createTestEditor();
      await importWith(
        editor,
        [
          '| Person | Bug Reports | Share |',
          '| :--- | :---: | :---: |',
          `| ${GAB_MENTION} | 206 | $$ 26.8\\% $$ |`,
        ].join('\n'),
        transformers
      );

      editor.getEditorState().read(() => {
        const grid = $cellGrid();
        expect(grid.map((row) => row.length)).toEqual([3, 3]);
        expect($cellTexts()[0]).toEqual(['Person', 'Bug Reports', 'Share']);

        const [mention] = $inlineNodes(grid[1][0]).filter($isUserMentionNode);
        expect(mention).toBeDefined();
        expect(mention.getUserId()).toBe('macro|gab@macro.com');
        expect(mention.getEmail()).toBe('gab@macro.com');
        expect(grid[1][1].getTextContent().trim()).toBe('206');
        const [share] = $inlineNodes(grid[1][2]).filter($isEquationNode);
        expect(share?.getEquation().trim()).toBe('26.8\\%');
      });
    });
  }

  it('imports in-app chip tags written inside cells (agent chat replies)', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      [
        '| Person | Share | Notify |',
        '| --- | --- | --- |',
        `| ${GAB_MENTION} | <m-katex-equation>{"equation":"26.8\\\\%","inline":true}</m-katex-equation> | <m-group-mention>{"groupAlias":"here"}</m-group-mention> |`,
      ].join('\n'),
      ALL_TRANSFORMERS
    );

    editor.getEditorState().read(() => {
      const grid = $cellGrid();
      expect(grid.map((row) => row.length)).toEqual([3, 3]);
      const [person, share, notify] = grid[1];

      const [mention] = $inlineNodes(person).filter($isUserMentionNode);
      expect(mention?.getUserId()).toBe('macro|gab@macro.com');

      const [equation] = $inlineNodes(share).filter($isEquationNode);
      expect(equation?.getEquation()).toBe('26.8\\%');
      expect(equation?.getInline()).toBe(true);

      const [group] = $inlineNodes(notify).filter($isGroupMentionNode);
      expect(group?.getGroupAlias()).toBe('here');
    });
  });

  it('exports cell chips the way a paragraph exports them', async () => {
    const editor = createTestEditor();
    await importWith(editor, `${GAB_MENTION} $$ 26.8\\% $$`, ALL_TRANSFORMERS);
    const paragraph = exportMarkdown(editor, EXTERNAL_TRANSFORMERS).trim();

    await importWith(
      editor,
      ['| Person |', '| --- |', `| ${GAB_MENTION} $$ 26.8\\% $$ |`].join('\n'),
      ALL_TRANSFORMERS
    );
    const table = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);

    expect(paragraph).not.toContain('<m-');
    expect(table.split('\n')).toContain(`| ${paragraph} |`);
  });

  it('exports every chip in a cell the way a paragraph exports it', async () => {
    const editor = createTestEditor();
    const chips = [
      '<m-group-mention>{"groupAlias":"here"}</m-group-mention>',
      '<m-tag>{"optionId":"tag-1","propertyDefinitionId":"prop-1","scope":"team","name":"Launch","color":"#0091FF"}</m-tag>',
      '<m-pr-mention>{"id":"foreign-1","label":"macro-inc/macro#7945","url":"https://github.com/macro-inc/macro/pull/7945"}</m-pr-mention>',
      '<m-agent-session-mention>{"id":"01a10ac3-013f-72f8-afbb-3bad148dee04","label":"Agent"}</m-agent-session-mention>',
      '<m-not-a-real-tag>{"x":1}</m-not-a-real-tag>',
    ].join(' ');
    await importWith(editor, chips, ALL_TRANSFORMERS);
    const paragraph = exportMarkdown(editor, EXTERNAL_TRANSFORMERS).trim();

    await importWith(
      editor,
      ['| Chips |', '| --- |', `| ${chips} |`].join('\n'),
      ALL_TRANSFORMERS
    );
    const table = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);

    expect(table.split('\n')).toContain(`| ${paragraph} |`);
  });

  it('imports a header row with alignment markers and an empty first cell', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      [
        '| Rank | Person |',
        '| ---: | :--- |',
        '| 1 | a |',
        '| | **Total** |',
      ].join('\n')
    );

    editor.getEditorState().read(() => {
      expect($cellTexts()).toEqual([
        ['Rank', 'Person'],
        ['1', 'a'],
        ['', 'Total'],
      ]);
    });
  });

  it('keeps inline formatting, code with an escaped pipe, escaped pipes and inline math in their cells', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      [
        '| Bold | Code | Escaped | Math |',
        '| --- | --- | --- | --- |',
        '| **strong** | `a\\|b` | x \\| y | $$27.4\\%$$ |',
      ].join('\n')
    );

    editor.getEditorState().read(() => {
      const grid = $cellGrid();
      expect(grid.map((row) => row.length)).toEqual([4, 4]);
      const [bold, code, escaped, math] = grid[1];

      const [strong] = $inlineNodes(bold);
      expect(strong.getTextContent()).toBe('strong');
      expect($isTextNode(strong) && strong.hasFormat('bold')).toBe(true);

      const [codeText] = $inlineNodes(code);
      expect(codeText.getTextContent()).toBe('a|b');
      expect($isTextNode(codeText) && codeText.hasFormat('code')).toBe(true);

      expect(escaped.getTextContent().trim()).toBe('x | y');

      const [equation] = $inlineNodes(math).filter($isEquationNode);
      expect(equation).toBeDefined();
      expect(equation.getEquation()).toBe('27.4\\%');
    });
  });

  it('escapes literal pipes in cell text on export', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      row.append($createCell('a|b'), $createCell('c'));
      table.append(row);
      $getRoot().append(table);
    });

    const markdown = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);
    expect(markdown).toBe('| a\\|b | c |\n| --- | --- |');

    await importWith(editor, markdown);
    editor.getEditorState().read(() => {
      expect($cellTexts()).toEqual([['a|b', 'c']]);
    });
  });

  it('writes the GFM delimiter row, with alignment, after the first row only', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      [
        '| Person | Bug Reports |',
        '| :--- | :---: |',
        `| ${GAB_MENTION} | 206 |`,
        '| Plain row | 117 |',
      ].join('\n'),
      ALL_TRANSFORMERS
    );

    expect(exportMarkdown(editor, EXTERNAL_TRANSFORMERS).split('\n')).toEqual([
      '| Person | Bug Reports |',
      '| :--- | :---: |',
      '| @gab | 206 |',
      '| Plain row | 117 |',
    ]);
  });

  it('makes the row above a delimiter a header and aligns its columns', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      [
        '| Person | Bug Reports | Share | Note |',
        '| :--- | :---: | ---: | --- |',
        '| a | 206 | 26.8% | x |',
        '| b | 117 | 15.3% | y |',
      ].join('\n')
    );

    editor.getEditorState().read(() => {
      const grid = $cellGrid();
      expect(
        grid.map((row) =>
          row.map((cell) => cell.hasHeaderState(TableCellHeaderStates.ROW))
        )
      ).toEqual([
        [true, true, true, true],
        [false, false, false, false],
        [false, false, false, false],
      ]);
      expect(
        grid.map((row) => row.map((cell) => cell.getFormatType()))
      ).toEqual([
        ['left', 'center', 'right', ''],
        ['left', 'center', 'right', ''],
        ['left', 'center', 'right', ''],
      ]);
    });
  });

  it('loads a table without a delimiter row as body rows, as before', async () => {
    const editor = createTestEditor();
    await importWith(editor, ['| a | b |', '| c | d |'].join('\n'));

    editor.getEditorState().read(() => {
      const grid = $cellGrid();
      expect($cellTexts()).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
      expect(
        grid
          .flat()
          .some((cell) => cell.hasHeaderState(TableCellHeaderStates.ROW))
      ).toBe(false);
    });
  });

  it('keeps the full mention, header and alignment through the internal (lossless) set', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      [
        '| Person | Share |',
        '| :--- | :---: |',
        `| ${GAB_MENTION} | $$ 26.8\\% $$ |`,
      ].join('\n'),
      ALL_TRANSFORMERS
    );
    const first = exportMarkdown(editor, INTERNAL_TRANSFORMERS);
    expect(first).toContain(
      '<m-user-mention>{"userId":"macro|gab@macro.com","email":"gab@macro.com"'
    );
    expect(first).toContain('<m-table-cell header="row" align="left">Person');

    await importWith(editor, first, INTERNAL_TRANSFORMERS);
    expect(exportMarkdown(editor, INTERNAL_TRANSFORMERS)).toBe(first);

    editor.getEditorState().read(() => {
      const grid = $cellGrid();
      const [mention] = $inlineNodes(grid[1][0]).filter($isUserMentionNode);
      expect(mention?.getUserId()).toBe('macro|gab@macro.com');
      expect(mention?.getEmail()).toBe('gab@macro.com');
      expect(grid[0][1].hasHeaderState(TableCellHeaderStates.ROW)).toBe(true);
      expect(grid[1][1].getFormatType()).toBe('center');
    });
  });

  it('round-trips a literal backslash before a pipe in cell text', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      row.append($createCell('C:\\|x'), $createCell('y'));
      table.append(row);
      $getRoot().append(table);
    });

    const markdown = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);
    await importWith(editor, markdown);
    editor.getEditorState().read(() => {
      expect($cellTexts()).toEqual([['C:\\|x', 'y']]);
    });
  });

  it('keeps an empty row after the first row as a row, not a delimiter', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      ['| Name | Score |', '| | |', '| a | 1 |'].join('\n')
    );

    editor.getEditorState().read(() => {
      const grid = $cellGrid();
      expect($cellTexts()).toEqual([
        ['Name', 'Score'],
        ['', ''],
        ['a', '1'],
      ]);
      expect(
        grid
          .flat()
          .some((cell) => cell.hasHeaderState(TableCellHeaderStates.ROW))
      ).toBe(false);
    });
  });

  it('keeps start and end alignment through the internal table XML', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      const start = $createCell('a');
      start.setFormat('start');
      const end = $createCell('b');
      end.setFormat('end');
      row.append(start, end);
      table.append(row);
      $getRoot().append(table);
    });

    const first = exportMarkdown(editor, INTERNAL_TRANSFORMERS);
    await importWith(editor, first, INTERNAL_TRANSFORMERS);
    editor.getEditorState().read(() => {
      expect($cellGrid()[0].map((cell) => cell.getFormatType())).toEqual([
        'start',
        'end',
      ]);
    });
  });

  it('splits on an unescaped pipe inside backticks, as GFM does', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      [
        '| a | b | c |',
        '| --- | --- | --- |',
        '| press ` key | b | then ` again |',
      ].join('\n')
    );

    editor.getEditorState().read(() => {
      expect($cellGrid().map((row) => row.length)).toEqual([3, 3]);
    });
  });

  it('round-trips literal backslash-pipe text typed in a cell', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      row.append($createCell('x \\| y'), $createCell('z'));
      table.append(row);
      $getRoot().append(table);
    });

    await importWith(editor, exportMarkdown(editor, EXTERNAL_TRANSFORMERS));
    editor.getEditorState().read(() => {
      expect($cellTexts()[0]).toEqual(['x \\| y', 'z']);
    });
  });

  it('protects pipes only inside a complete <m-…>{json}</m-…> tag in one cell', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      [
        '| a | b | c |',
        '| --- | --- | --- |',
        '| <m-user-mention>broken | b | x</m-user-mention> |',
      ].join('\n')
    );

    editor.getEditorState().read(() => {
      expect($cellGrid().map((row) => row.length)).toEqual([3, 3]);
    });
  });

  it('imports every inline chip a paragraph imports, unknown tags included', async () => {
    const editor = createTestEditor();
    const chips = [
      '<m-tag-mention>{"tagId":"t1","name":"urgent"}</m-tag-mention>',
      '<m-not-a-real-tag>{"x":1}</m-not-a-real-tag>',
    ];
    await importWith(editor, chips.join(' '), ALL_TRANSFORMERS);
    const paragraphTypes = editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .flatMap((child) => ($isElementNode(child) ? child.getChildren() : []))
        .map((node) => node.getType())
        .filter((type) => type !== 'text')
    );

    await importWith(
      editor,
      ['| a |', '| --- |', `| ${chips.join(' ')} |`].join('\n'),
      ALL_TRANSFORMERS
    );
    editor.getEditorState().read(() => {
      const cellTypes = $inlineNodes($cellGrid()[1][0])
        .map((node) => node.getType())
        .filter((type) => type !== 'text');
      expect(paragraphTypes.length).toBe(2);
      expect(cellTypes).toEqual(paragraphTypes);
    });
  });

  it('keeps justify alignment through the internal table XML', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      const cell = $createCell('a');
      cell.setFormat('justify');
      row.append(cell);
      table.append(row);
      $getRoot().append(table);
    });

    await importWith(
      editor,
      exportMarkdown(editor, INTERNAL_TRANSFORMERS),
      INTERNAL_TRANSFORMERS
    );
    editor.getEditorState().read(() => {
      expect($cellGrid()[0][0].getFormatType()).toBe('justify');
    });
  });

  it('keeps a delimiter-looking row after the second row as a text row', async () => {
    const editor = createTestEditor();
    await importWith(
      editor,
      ['| a | b |', '| c | d |', '| --- | :---: |', '| e | f |'].join('\n')
    );

    editor.getEditorState().read(() => {
      expect($cellTexts()).toEqual([
        ['a', 'b'],
        ['c', 'd'],
        ['---', ':---:'],
        ['e', 'f'],
      ]);
    });
  });

  it('never overwrites the alignment of a cell that already has one', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const header = $createTableRowNode();
      const kept = $createCell('kept');
      kept.setFormat('right');
      header.append(kept, $createCell('set'));
      table.append(header);
      $getRoot().append(table);
    });

    // Lines typed under the table go through the markdown shortcut one by one.
    for (const line of ['| :---: | :---: |', '| x | y |']) {
      editor.update(
        () => {
          const paragraph = $createParagraphNode().append(
            $createTextNode(line)
          );
          $getRoot().append(paragraph);
          const match = line.match(E_TABLE_NODE.regExp);
          if (match) E_TABLE_NODE.replace(paragraph, [], match, true);
        },
        { discrete: true }
      );
    }

    editor.getEditorState().read(() => {
      expect(
        $cellGrid().map((row) => row.map((cell) => cell.getFormatType()))
      ).toEqual([
        ['right', 'center'],
        ['right', 'center'],
      ]);
    });
  });

  it('turns $x$ into math in a cell exactly when a paragraph does', async () => {
    const editor = createTestEditor();
    const samples = ['$x+1$', '$5 and $10', 'costs $3'];
    for (const sample of samples) {
      await importWith(editor, sample);
      const inParagraph = editor.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .flatMap((child) =>
            $isElementNode(child) ? child.getChildren() : []
          )
          .some($isEquationNode)
      );
      await importWith(
        editor,
        ['| a |', '| --- |', `| ${sample} |`].join('\n')
      );
      const inCell = editor
        .getEditorState()
        .read(() => $inlineNodes($cellGrid()[1][0]).some($isEquationNode));
      expect([sample, inCell]).toEqual([sample, inParagraph]);
    }
  });

  it('keeps a headerless table headerless through the internal table XML', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const table = $createTableNode();
      const row = $createTableRowNode();
      row.append($createCell('a'), $createCell('b'));
      table.append(row);
      $getRoot().append(table);
    });

    await importWith(
      editor,
      exportMarkdown(editor, INTERNAL_TRANSFORMERS),
      INTERNAL_TRANSFORMERS
    );
    editor.getEditorState().read(() => {
      expect(
        $cellGrid()
          .flat()
          .some((cell) => cell.hasHeaderState(TableCellHeaderStates.ROW))
      ).toBe(false);
    });
  });

  it('keeps every cell chip through the internal (lossless) table XML', async () => {
    const editor = createTestEditor();
    const chips = [
      '<m-group-mention>{"groupAlias":"here"}</m-group-mention>',
      '<m-tag-mention>{"tagId":"t1","name":"urgent"}</m-tag-mention>',
      '<m-pr-mention>{"url":"https://github.com/o/r/pull/1","label":""}</m-pr-mention>',
    ];
    await importWith(
      editor,
      ['| a |', '| --- |', `| ${chips.join(' ')} |`].join('\n'),
      ALL_TRANSFORMERS
    );
    const $chipTypes = () =>
      $inlineNodes($cellGrid()[1][0])
        .map((node) => node.getType())
        .filter((type) => type !== 'text');
    const imported = editor.getEditorState().read($chipTypes);

    const saved = exportMarkdown(editor, INTERNAL_TRANSFORMERS);
    await importWith(editor, saved, INTERNAL_TRANSFORMERS);

    expect(imported).toHaveLength(3);
    expect(editor.getEditorState().read($chipTypes)).toEqual(imported);
  });

  it('imports an <m-link> in a cell as a link and keeps it through the internal XML', async () => {
    const editor = createTestEditor();
    const link =
      '<m-link>{"url":"https://example.com/a","text":"example"}</m-link>';
    await importWith(
      editor,
      ['| a |', '| --- |', `| ${link} |`].join('\n'),
      ALL_TRANSFORMERS
    );
    const $linkUrls = () =>
      $inlineNodes($cellGrid()[1][0])
        .filter($isLinkNode)
        .map((node) => node.getURL());
    expect(editor.getEditorState().read($linkUrls)).toEqual([
      'https://example.com/a',
    ]);

    await importWith(
      editor,
      exportMarkdown(editor, INTERNAL_TRANSFORMERS),
      INTERNAL_TRANSFORMERS
    );
    expect(editor.getEditorState().read($linkUrls)).toEqual([
      'https://example.com/a',
    ]);
  });

  it('round-trips markdown -> lexical -> markdown stably', async () => {
    const source = [
      '| Person | Code | Note |',
      '| --- | --- | --- |',
      `| ${GAB_MENTION} | \`a\\|b\` | x \\| y |`,
    ].join('\n');

    const editor = createTestEditor();
    await importWith(editor, source);
    const first = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);

    await importWith(editor, first);
    const second = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);
    expect(second).toBe(first);

    editor.getEditorState().read(() => {
      const grid = $cellGrid();
      expect(grid.map((row) => row.length)).toEqual([3, 3]);
      // External Markdown writes a mention as its label, as in a paragraph.
      expect(grid[1][0].getTextContent().trim()).toBe('@gab');
      expect(grid[1][1].getTextContent()).toBe('a|b');
      expect(grid[1][2].getTextContent().trim()).toBe('x | y');
    });
  });
});

describe('video link transformer', () => {
  it('converts markdown links with video URLs to video nodes', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '[Screen Recording 2026-10-06 at 4.03.28 PM.mov](https://static-file-service.macro.com/file/3d7ab8c8-05b7-477f-aa83-7dd514219867)'
    );

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const video = root.getChildren().find($isVideoNode);
      expect(video).toBeDefined();
      expect(video!.getUrl()).toBe(
        'https://static-file-service.macro.com/file/3d7ab8c8-05b7-477f-aa83-7dd514219867'
      );
    });
  });

  it('converts links with .mp4 extension to video nodes', async () => {
    const editor = createTestEditor();
    await importMarkdown(editor, '[Video](https://example.com/video.mp4)');

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const video = root.getChildren().find($isVideoNode);
      expect(video).toBeDefined();
      expect(video!.getUrl()).toBe('https://example.com/video.mp4');
    });
  });

  it('converts links with .mov extension to video nodes', async () => {
    const editor = createTestEditor();
    await importMarkdown(editor, '[Recording](https://example.com/clip.mov)');

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const video = root.getChildren().find($isVideoNode);
      expect(video).toBeDefined();
      expect(video!.getUrl()).toBe('https://example.com/clip.mov');
    });
  });

  it('leaves non-video links as links', async () => {
    const editor = createTestEditor();
    await importMarkdown(editor, '[Document](https://example.com/doc.pdf)');

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().find($isVideoNode)).toBeUndefined();
      expect(root.getTextContent()).toContain('Document');
    });
    expect(exportMarkdown(editor)).toContain('https://example.com/doc.pdf');
  });

  it('leaves static-file PDF links as links', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '[Report.pdf](https://static-file-service.macro.com/file/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)'
    );

    editor.getEditorState().read(() => {
      expect($getRoot().getChildren().find($isVideoNode)).toBeUndefined();
      expect($getRoot().getTextContent()).toContain('Report.pdf');
    });
    expect(exportMarkdown(editor)).toContain(
      'static-file-service.macro.com/file/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    );
  });

  it('does not turn a trailing inline video link into a block video', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      'Watch this: [clip](https://example.com/clip.mp4)'
    );

    editor.getEditorState().read(() => {
      expect($getRoot().getChildren().find($isVideoNode)).toBeUndefined();
      expect($getRoot().getTextContent()).toContain('Watch this:');
    });
  });

  it('ignores a video extension that only appears in a query string', async () => {
    const editor = createTestEditor();
    await importMarkdown(
      editor,
      '[Document](https://example.com/document.pdf?next=clip.mp4)'
    );

    editor.getEditorState().read(() => {
      expect($getRoot().getChildren().find($isVideoNode)).toBeUndefined();
      expect($getRoot().getTextContent()).toContain('Document');
    });
    expect(exportMarkdown(editor)).toContain('document.pdf?next=clip.mp4');
  });
});

describe('isolatePipeTables', () => {
  it('keeps a header-and-delimiter table and gives it a blank line above', () => {
    expect(
      isolatePipeTables(
        '<m-table><m-table-row><m-table-cell>Old</m-table-cell></m-table-row></m-table>\n| Step | Done |\n| --- | :---: |\n| Ship | yes |\nAfter'
      )
    ).toBe(
      '<m-table><m-table-row><m-table-cell>Old</m-table-cell></m-table-row></m-table>\n\n| Step | Done |\n| --- | :---: |\n| Ship | yes |\nAfter'
    );
  });

  it('escapes pipe lines that are not a table so they stay text', () => {
    expect(
      isolatePipeTables(
        '| plain text |\n\n| a | b |\n| --- |\n\n| --- |\n| x |'
      )
    ).toBe('\\| plain text |\n\n\\| a | b |\n\\| --- |\n\n\\| --- |\n\\| x |');
  });

  it('keeps a table run that is already text in an existing paragraph', () => {
    expect(
      isolatePipeTables('| H |\n| --- |\n| B |\n\n| N |\n| --- |', [
        'Intro\n| H |\n| --- |\n| B |',
      ])
    ).toBe('\\| H |\n\\| --- |\n\\| B |\n\n| N |\n| --- |');
  });

  it('pads a short body row with empty cells to the header width', () => {
    expect(isolatePipeTables('| A | B | C |\n| --- | --- | --- |\n| x |')).toBe(
      '| A | B | C |\n| --- | --- | --- |\n| x | | |'
    );
  });

  it('leaves pipe lines in fenced code alone', () => {
    const markdown = '```\n| a |\n| --- |\n| plain |\n```';
    expect(isolatePipeTables(markdown)).toBe(markdown);
  });
});
