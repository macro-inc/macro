/** @vitest-environment jsdom */
// Source oracle (pinned lexical/@lexical/code 0.45 registerCodeHighlighting) for the native leaf
// transforms: typing inside code reaches the tokenizer, and an orphaned code-highlight becomes
// plain text. The tokenizer is the native fixture's word/space split, not Prism.
import {
  $createCodeHighlightNode,
  $createCodeNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
  registerCodeHighlighting,
} from '@lexical/code';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalNode,
} from 'lexical';
import { expect, test } from 'vitest';

type Tokenizer = NonNullable<Parameters<typeof registerCodeHighlighting>[1]>;

function sourceEditor() {
  const calls: [string, string][] = [];
  const editor = createEditor({
    namespace: 'code-leaf-source',
    nodes: [CodeNode, CodeHighlightNode],
    onError(error) {
      throw error;
    },
  });
  editor.setRootElement(document.createElement('div'));
  const tokenizer: Tokenizer = {
    defaultLanguage: 'plaintext',
    tokenize(code) {
      return code.split(/( )/).filter(Boolean);
    },
    $tokenize(code: CodeNode, language?: string): LexicalNode[] {
      const text = code.getTextContent();
      calls.push([language ?? '', text]);
      return text
        .split(/( )/)
        .filter(Boolean)
        .map((part) =>
          $createCodeHighlightNode(part, part === ' ' ? undefined : 'word')
        );
    },
  };
  return { editor, calls, tokenizer };
}

const shape = (editor: ReturnType<typeof createEditor>) =>
  editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((block) => ({
        type: block.getType(),
        children: ($isCodeNode(block) || block.getType() === 'paragraph'
          ? (block as CodeNode).getChildren()
          : []
        ).map((child) => [
          child.getType(),
          child.getTextContent(),
          child instanceof CodeHighlightNode
            ? (child.getLatest().__highlightType ?? null)
            : null,
        ]),
      }))
  );

test('Source: typing inside code reaches the tokenizer through the text transform', () => {
  const { editor, calls, tokenizer } = sourceEditor();
  editor.update(
    () => {
      const code = $createCodeNode('plaintext');
      code.append($createTextNode('let a'));
      $getRoot().append(code);
    },
    { discrete: true }
  );
  const unregister = registerCodeHighlighting(editor, tokenizer);
  // Commit registration's own highlight pass first: within one update Source tokenizes each code
  // node once (nodesCurrentlyHighlighting), so a merged edit would keep stale tokens.
  editor.update(() => {}, { discrete: true });
  try {
    editor.update(
      () => {
        const text = $getRoot()
          .getFirstChildOrThrow<CodeNode>()
          .getLastChildOrThrow();
        text.selectEnd().insertText(' b');
      },
      { discrete: true }
    );
    expect(calls).toContainEqual(['plaintext', 'let a b']);
    expect(shape(editor)).toEqual([
      {
        type: 'code',
        children: [
          ['code-highlight', 'let', 'word'],
          ['code-highlight', ' ', null],
          ['code-highlight', 'a', 'word'],
          ['code-highlight', ' ', null],
          ['code-highlight', 'b', 'word'],
        ],
      },
    ]);
  } finally {
    unregister();
  }
});

test('Source: an orphaned code-highlight becomes plain text', () => {
  const { editor, calls, tokenizer } = sourceEditor();
  const unregister = registerCodeHighlighting(editor, tokenizer);
  try {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createCodeHighlightNode('let', 'keyword'));
        $getRoot().append(paragraph);
      },
      { discrete: true }
    );
    expect(shape(editor)).toEqual([
      { type: 'paragraph', children: [['text', 'let', null]] },
    ]);
    expect(calls).toEqual([]);
  } finally {
    unregister();
  }
});
