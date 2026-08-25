import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableNode,
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
  $canHostTable,
  $createCollapsibleSection,
  $isCollapsibleContainerNode,
  $isCollapsibleContentNode,
  $isCollapsibleTitleNode,
} from '../nodes/collapsible';
import { EXTERNAL_TRANSFORMERS, INTERNAL_TRANSFORMERS } from '../transformers';

function createTestEditor() {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
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

describe('collapsible sections', () => {
  it('round-trips heading size variants through internal markdown', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const section = $createCollapsibleSection({ heading: 'h2' });
      section.getTitle()?.append($createTextNode('Release notes'));
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('Shipped tables.'));
      section.getContent()?.clear();
      section.getContent()?.append(paragraph);
      $getRoot().append(section);
    });

    const markdown = exportMarkdown(editor);
    expect(markdown).toContain('<m-collapsible>');
    expect(markdown).toContain('h2');
    expect(markdown).toContain('Release notes');

    await importMarkdown(editor, markdown);

    editor.getEditorState().read(() => {
      const container = $getRoot().getFirstChild();
      expect($isCollapsibleContainerNode(container)).toBe(true);
      if (!$isCollapsibleContainerNode(container)) return;
      const title = container.getTitle();
      const content = container.getContent();
      expect($isCollapsibleTitleNode(title)).toBe(true);
      expect(title?.getHeading()).toBe('h2');
      expect(title?.getTextContent()).toBe('Release notes');
      expect($isCollapsibleContentNode(content)).toBe(true);
      expect(content?.getTextContent()).toContain('Shipped tables.');
      expect($canHostTable(content)).toBe(true);
    });
  });

  it('keeps a table inside collapsible content across a markdown round-trip', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const section = $createCollapsibleSection({ heading: 'h1' });
      section.getTitle()?.append($createTextNode('Scores'));

      const table = $createTableNode();
      const row = $createTableRowNode();
      const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode('Ada'));
      cell.append(paragraph);
      row.append(cell);
      table.append(row);

      section.getContent()?.clear();
      section.getContent()?.append(table);
      $getRoot().append(section);
    });

    const markdown = exportMarkdown(editor);
    expect(markdown).toContain('<m-collapsible>');
    expect(markdown).toContain('m-table');

    await importMarkdown(editor, markdown);

    editor.getEditorState().read(() => {
      const container = $getRoot().getFirstChild();
      expect($isCollapsibleContainerNode(container)).toBe(true);
      if (!$isCollapsibleContainerNode(container)) return;
      expect(container.getTitle()?.getHeading()).toBe('h1');
      const child = container.getContent()?.getFirstChild();
      expect($isTableNode(child)).toBe(true);
      expect(child?.getTextContent()).toContain('Ada');
    });
  });

  it('exports GitHub-style details with heading-sized summaries', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const section = $createCollapsibleSection({ heading: 'h3' });
      section.getTitle()?.append($createTextNode('Appendix'));
      $getRoot().append(section);
    });

    const markdown = exportMarkdown(editor, EXTERNAL_TRANSFORMERS);
    expect(markdown).toContain('<details>');
    expect(markdown).toContain('<summary>');
    expect(markdown).toContain('### Appendix');
    expect(markdown).toContain('</details>');
  });

  it('round-trips a nested collapsible through internal markdown', async () => {
    const editor = createTestEditor();
    await buildEditorState(editor, () => {
      const inner = $createCollapsibleSection({ heading: 'h3' });
      inner.getTitle()?.append($createTextNode('Inner'));
      const outer = $createCollapsibleSection({ heading: 'h1' });
      outer.getTitle()?.append($createTextNode('Outer'));
      outer.getContent()?.clear();
      outer.getContent()?.append(inner);
      $getRoot().append(outer);
    });

    const markdown = exportMarkdown(editor);
    expect(markdown).toContain('<m-collapsible>');

    await importMarkdown(editor, markdown);

    editor.getEditorState().read(() => {
      const outer = $getRoot().getFirstChild();
      expect($isCollapsibleContainerNode(outer)).toBe(true);
      if (!$isCollapsibleContainerNode(outer)) return;
      expect(outer.getTitle()?.getHeading()).toBe('h1');
      expect(outer.getTitle()?.getTextContent()).toBe('Outer');
      const nested = outer.getContent()?.getFirstChild();
      expect($isCollapsibleContainerNode(nested)).toBe(true);
      if (!$isCollapsibleContainerNode(nested)) return;
      expect(nested.getTitle()?.getHeading()).toBe('h3');
      expect(nested.getTitle()?.getTextContent()).toBe('Inner');
    });
  });
});
