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
import {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from '../transformers';
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

function importMarkdown(markdown: string, protect = true): LexicalEditor {
  const editor = makeEditor();
  editor.update(
    () => {
      $convertFromMarkdownString(
        protect
          ? protectEmptyParagraphLines(markdown, ALL_TRANSFORMERS)
          : markdown,
        ALL_TRANSFORMERS
      );
    },
    { discrete: true }
  );
  return editor;
}

function textContent(editor: LexicalEditor): string {
  return editor.read(() => $getRoot().getTextContent());
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

    expect(protectEmptyParagraphLines(markdown, ALL_TRANSFORMERS)).toBe(
      markdown
    );
    expect(textContent(importMarkdown(markdown))).toBe('a\n \nb');
  });

  it.each([
    ['a shorter fence inside a longer one', '````\n```\n \n````'],
    ['an unclosed fence', '```\na\n \nb'],
  ])('keeps the sentinel out of %s', (_name, markdown) => {
    expect(protectEmptyParagraphLines(markdown, ALL_TRANSFORMERS)).toBe(
      markdown
    );
    // Lexical's own normalizer decides what happens to the space from here.
    expect(textContent(importMarkdown(markdown))).toBe(
      textContent(importMarkdown(markdown, false))
    );
  });

  it('protects a blank line after a fence that closes on its own line', () => {
    expect(protectEmptyParagraphLines('```a```\n \nb', ALL_TRANSFORMERS)).toBe(
      '```a```\n\u200b\nb'
    );
  });

  it('leaves markdown alone when nothing will read the sentinel', () => {
    expect(
      protectEmptyParagraphLines('a\n\n \n\nb', EXTERNAL_TRANSFORMERS)
    ).toBe('a\n\n \n\nb');
  });

  it('keeps a soft line break inside one paragraph', () => {
    expect(paragraphs(importMarkdown('a\nb'))).toEqual(['a\nb']);
  });
});
