import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertSelectionToMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from '@lexical/markdown';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  type TextFormatType,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from '../transformers';

type TextSpec = {
  formats: TextFormatType[];
  text: string;
};

function createEditorFromText(specs: TextSpec[]) {
  const editor = createHeadlessEditor({ nodes: [...SupportedNodeTypes] });
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      for (const { formats, text } of specs) {
        const textNode = $createTextNode(text);
        for (const format of formats) {
          textNode.toggleFormat(format);
        }
        paragraph.append(textNode);
      }
      $getRoot().append(paragraph);
    },
    { discrete: true }
  );
  return editor;
}

function importMarkdown(markdown: string, transformers: Transformer[]) {
  const editor = createHeadlessEditor({ nodes: [...SupportedNodeTypes] });
  editor.update(() => $convertFromMarkdownString(markdown, transformers), {
    discrete: true,
  });
  return editor;
}

function exportMarkdown(
  editor: ReturnType<typeof createHeadlessEditor>,
  transformers: Transformer[]
) {
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(transformers));
}

function readTextSpecs(editor: ReturnType<typeof createHeadlessEditor>) {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getAllTextNodes()
      .map((node) => ({
        formats: [
          'bold',
          'italic',
          'underline',
          'superscript',
          'subscript',
        ].filter((format): format is TextFormatType => node.hasFormat(format)),
        text: node.getTextContent(),
      }))
  );
}

function readNonWhitespaceTextSpecs(
  editor: ReturnType<typeof createHeadlessEditor>
) {
  return readTextSpecs(editor)
    .map(({ formats, text }) => ({ formats, text: text.trim() }))
    .filter(({ text }) => text !== '');
}

describe('HTML text format Markdown transformers', () => {
  it.each([
    ['underline', '<u>underline</u>'],
    ['superscript', '<sup>superscript</sup>'],
    ['subscript', '<sub>subscript</sub>'],
  ] as const)('serializes %s with paired HTML tags', (format, markdown) => {
    const editor = createEditorFromText([{ formats: [format], text: format }]);

    expect(exportMarkdown(editor, INTERNAL_TRANSFORMERS)).toBe(markdown);
    expect(exportMarkdown(editor, EXTERNAL_TRANSFORMERS)).toBe(markdown);
  });

  it('imports paired HTML tags as Lexical formats', () => {
    const markdown =
      '<u>underlined</u> <sup>superscript</sup> <sub>subscript</sub>';
    const editor = importMarkdown(markdown, ALL_TRANSFORMERS);

    expect(readTextSpecs(editor)).toEqual([
      { formats: ['underline'], text: 'underlined' },
      { formats: [], text: ' ' },
      { formats: ['superscript'], text: 'superscript' },
      { formats: [], text: ' ' },
      { formats: ['subscript'], text: 'subscript' },
    ]);
  });

  it('round-trips nested HTML and standard Markdown formats', () => {
    const markdown = '<u>plain **bold <sup>and raised</sup>**</u>';
    const imported = importMarkdown(markdown, ALL_TRANSFORMERS);
    const serialized = exportMarkdown(imported, INTERNAL_TRANSFORMERS);
    const roundTripped = importMarkdown(serialized, ALL_TRANSFORMERS);

    expect(
      roundTripped.getEditorState().read(() => $getRoot().getTextContent())
    ).toBe(imported.getEditorState().read(() => $getRoot().getTextContent()));
    expect(readNonWhitespaceTextSpecs(roundTripped)).toEqual(
      readNonWhitespaceTextSpecs(imported)
    );
  });

  it('keeps Markdown delimiters within HTML format boundaries', () => {
    const editor = createEditorFromText([
      { formats: ['bold'], text: 'bold ' },
      { formats: ['bold', 'underline'], text: 'and underlined' },
      { formats: ['italic', 'superscript'], text: ' raised' },
      { formats: ['italic'], text: ' and italic' },
    ]);
    const serialized = exportMarkdown(editor, INTERNAL_TRANSFORMERS);
    const roundTripped = importMarkdown(serialized, ALL_TRANSFORMERS);

    expect(serialized).toContain('**bold <u>and underlined</u>**');
    expect(serialized).toContain('*<sup>raised</sup> and italic*');
    expect(readNonWhitespaceTextSpecs(roundTripped)).toEqual(
      readNonWhitespaceTextSpecs(editor)
    );
  });

  it('round-trips HTML text formats inside external Markdown tables', () => {
    const markdown = '| <u>underlined</u> |\n| --- |';
    const imported = importMarkdown(markdown, EXTERNAL_TRANSFORMERS);

    expect(exportMarkdown(imported, EXTERNAL_TRANSFORMERS)).toContain(
      '<u>underlined</u>'
    );
  });

  it('serializes only the selected part of formatted text', () => {
    const editor = createEditorFromText([
      { formats: [], text: 'before ' },
      { formats: ['underline'], text: 'underlined' },
      { formats: [], text: ' after' },
    ]);

    editor.update(
      () => {
        $getRoot().getAllTextNodes()[1].select(2, 6);
      },
      { discrete: true }
    );

    expect(
      editor.read(() => {
        const selection = $getSelection();
        return $convertSelectionToMarkdownString(
          INTERNAL_TRANSFORMERS,
          selection
        );
      })
    ).toBe('<u>derl</u>');
  });
});
