import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { ALL_TRANSFORMERS, INTERNAL_TRANSFORMERS } from '../transformers';
import { protectEmptyParagraphLines } from '../transformers/transformers';

function makeEditor() {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
}

/** The paragraph structure a composer builds from the given lines. */
function withParagraphs(lines: string[]): LexicalEditor {
  const editor = makeEditor();
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      for (const line of lines) {
        const paragraph = $createParagraphNode();
        if (line) paragraph.append($createTextNode(line));
        root.append(paragraph);
      }
    },
    { discrete: true }
  );
  return editor;
}

function exportMarkdown(editor: LexicalEditor): string {
  return editor.read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
}

function importMarkdown(markdown: string): LexicalEditor {
  const editor = makeEditor();
  editor.update(
    () => {
      $convertFromMarkdownString(
        protectEmptyParagraphLines(markdown),
        ALL_TRANSFORMERS
      );
    },
    { discrete: true }
  );
  return editor;
}

function paragraphs(editor: LexicalEditor): string[] {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .filter($isParagraphNode)
      .map((node) => node.getTextContent())
  );
}

describe('empty paragraphs in internal markdown', () => {
  it.each([
    ['between paragraphs', ['hello', '', 'world']],
    ['repeated', ['hello', '', '', 'world']],
    ['leading', ['', 'hello']],
    ['trailing', ['hello', '']],
  ])('survives an export and import round trip: %s', (_name, lines) => {
    const markdown = exportMarkdown(withParagraphs(lines));
    const reloaded = importMarkdown(markdown);

    expect(paragraphs(reloaded)).toEqual(lines);
    expect(exportMarkdown(reloaded)).toBe(markdown);
  });

  it('leaves a lone space inside fenced code as content', () => {
    const markdown = '```\na\n \nb\n```';

    expect(protectEmptyParagraphLines(markdown)).toBe(markdown);
    expect(
      importMarkdown(markdown).read(() => $getRoot().getTextContent())
    ).toBe('a\n \nb');
  });

  it('keeps a soft line break inside one paragraph', () => {
    expect(paragraphs(importMarkdown('a\nb'))).toEqual(['a\nb']);
  });
});
