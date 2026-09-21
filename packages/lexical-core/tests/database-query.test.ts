import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot, $isParagraphNode, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $isDatabaseQueryNode,
  type DatabaseQueryData,
  databaseQueryMarkdown,
} from '../nodes/DatabaseQueryNode';
import { $isUnknownMentionNode } from '../nodes/UnknownMentionNode';
import { ALL_TRANSFORMERS } from '../transformers';
import { markdownToPlainText } from '../utils/parsers';

const source: DatabaseQueryData = {
  databaseId: 'db-1',
  tableId: 'projects-table',
  sql: 'SELECT COUNT(*) FROM projects',
  prompt: 'How many projects?',
  displayMode: 'scalar',
};
function parse(markdown: string) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
    },
    { discrete: true }
  );
  return editor;
}
function exported(editor: ReturnType<typeof createEditor>) {
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}
describe('database query node', () => {
  it.each(['bar', 'line', 'pie'] as const)(
    'round-trips a live %s chart as a source-only block',
    (displayMode) => {
      const chart = {
        ...source,
        displayMode,
        chart: { x: 'Status', y: ['Count'], title: 'Projects by status' },
      };
      const editor = parse(
        databaseQueryMarkdown({ ...chart, ...{ results: [['private']] } })
      );
      editor.getEditorState().read(() => {
        const node = $getRoot().getFirstChild();
        if (!$isDatabaseQueryNode(node)) throw new Error('Expected chart node');
        expect(node.isInline()).toBe(false);
        expect(node.exportComponentProps()).toEqual(chart);
      });
      const serialized = JSON.stringify(editor.getEditorState().toJSON());
      expect(serialized).not.toContain('private');
      const restored = createEditor({ nodes: SupportedNodeTypes });
      restored.setEditorState(restored.parseEditorState(serialized));
      expect(exported(restored)).toBe(databaseQueryMarkdown(chart));
    }
  );
  it('preserves older answers without table metadata', () => {
    const legacy = { ...source };
    delete legacy.tableId;
    const markdown = databaseQueryMarkdown(legacy);
    const editor = parse(markdown);
    expect(exported(editor)).toBe(markdown);
    expect(JSON.stringify(editor.getEditorState().toJSON())).not.toContain(
      'tableId'
    );
  });
  it('round-trips inline answers within a sentence', () => {
    const text = `We have ${databaseQueryMarkdown(source)} projects.`;
    const editor = parse(text);
    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      if (!$isParagraphNode(paragraph)) throw new Error('Expected paragraph');
      const node = paragraph.getChildren().find($isDatabaseQueryNode);
      expect(node?.exportComponentProps()).toEqual(source);
      expect(node?.isInline()).toBe(true);
    });
    expect(exported(editor)).toBe(text);
  });
  it('round-trips tables as root blocks', () => {
    const table = { ...source, displayMode: 'table' as const };
    const editor = parse(databaseQueryMarkdown(table));
    editor.getEditorState().read(() => {
      const node = $getRoot().getFirstChild();
      if (!$isDatabaseQueryNode(node)) throw new Error('Expected query');
      expect(node.isInline()).toBe(false);
      expect(node.exportComponentProps()).toEqual(table);
    });
    expect(exported(editor)).toBe(databaseQueryMarkdown(table));
  });
  it('keeps standalone scalar inside a paragraph', () => {
    const editor = parse(databaseQueryMarkdown(source));
    editor
      .getEditorState()
      .read(() =>
        expect($isParagraphNode($getRoot().getFirstChild())).toBe(true)
      );
    expect(exported(editor)).toBe(databaseQueryMarkdown(source));
  });
  it('serializes source only, ignoring results in input', () => {
    const editor = parse(
      databaseQueryMarkdown({
        ...source,
        ...{ results: [{ rows: [['private']] }], read_versions: { secret: 3 } },
      })
    );
    const serialized = JSON.stringify(editor.getEditorState().toJSON());
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('read_versions');
    const restored = createEditor({ nodes: SupportedNodeTypes });
    restored.setEditorState(restored.parseEditorState(serialized));
    expect(exported(restored)).toBe(databaseQueryMarkdown(source));
  });
  it('escapes closing tags in SQL and prompts', () => {
    const tricky = {
      ...source,
      prompt: 'Count </m-db-query> things',
      sql: `SELECT '</m-db-query>' AS answer`,
    };
    const text = databaseQueryMarkdown(tricky);
    expect(text.match(/<\/m-db-query>/g)).toHaveLength(1);
    expect(exported(parse(text))).toBe(text);
    expect(markdownToPlainText(text)).toBe(tricky.prompt);
  });
  it.each([
    '<m-db-query>{"sql":"SELECT 1","displayMode":"chart"}</m-db-query>',
    '<m-db-query>{"sql":"SELECT 1","prompt":"Count","tableId":42,"displayMode":"scalar"}</m-db-query>',
  ])('degrades malformed payloads to unavailable chips: %s', (markdown) => {
    const editor = parse(markdown);
    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      expect(
        $isParagraphNode(paragraph) &&
          paragraph.getChildren().some($isUnknownMentionNode)
      ).toBe(true);
    });
  });
});
