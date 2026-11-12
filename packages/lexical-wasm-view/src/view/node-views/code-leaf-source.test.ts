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
  $getSelection,
  $isRangeSelection,
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

test('Source: orphan replacement resets style and format and keeps the caret offset', () => {
  const { editor, tokenizer } = sourceEditor();
  const unregister = registerCodeHighlighting(editor, tokenizer);
  try {
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const highlight = $createCodeHighlightNode('let', 'keyword');
        highlight.setStyle('color: red');
        paragraph.append(highlight);
        $getRoot().append(paragraph);
        highlight.select(2, 2);
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const text = $getRoot()
        .getFirstChildOrThrow<CodeNode>()
        .getFirstChildOrThrow();
      expect(text.exportJSON()).toEqual({
        detail: 0,
        format: 0,
        mode: 'normal',
        style: '',
        text: 'let',
        type: 'text',
        version: 1,
      });
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error('Missing range');
      expect([selection.anchor.key, selection.anchor.offset]).toEqual([
        text.getKey(),
        2,
      ]);
    });
  } finally {
    unregister();
  }
});

// Within one pending update Source tokenizes each code node once, so an edit merged after the first
// pass keeps stale stored tokens until the next update. Native pin:
// dedupe_keeps_same_update_text_changes_stale_and_the_next_update_refreshes (tokens/test.rs).
test('Source raw control: an edit merged into the same pending update keeps stale tokens', () => {
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
  try {
    // Registration's pass is pending (not committed); this edit joins the same pending state.
    editor.update(
      () => {
        $getRoot()
          .getFirstChildOrThrow<CodeNode>()
          .getLastChildOrThrow()
          .selectEnd()
          .insertText(' b');
      },
      { discrete: true }
    );
    expect(calls).toEqual([['plaintext', 'let a']]);
    expect(shape(editor)).toEqual([
      {
        type: 'code',
        children: [
          ['code-highlight', 'let', 'word'],
          ['code-highlight', ' ', null],
          ['code-highlight', 'a b', 'word'],
        ],
      },
    ]);
    // The next committed update corrects it.
    editor.update(
      () => {
        $getRoot()
          .getFirstChildOrThrow<CodeNode>()
          .getLastChildOrThrow()
          .selectEnd()
          .insertText('c');
      },
      { discrete: true }
    );
    expect(calls.at(-1)).toEqual(['plaintext', 'let a bc']);
    expect(shape(editor)[0]?.children.map((child) => child[1])).toEqual([
      'let',
      ' ',
      'a',
      ' ',
      'bc',
    ]);
  } finally {
    unregister();
  }
});

// Native pin: an_orphan_still_becomes_text_while_its_code_node_is_deduped (tokens/test.rs).
test('Source: an orphan becomes text while its code node is deduped in the same update', () => {
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
  try {
    // Joins registration's pending pass, which already tokenized the code node.
    editor.update(
      () => {
        const code = $getRoot().getFirstChildOrThrow<CodeNode>();
        code.getLastChildOrThrow().selectEnd().insertText('b');
        const paragraph = $createParagraphNode();
        paragraph.append(code.getFirstChildOrThrow());
        $getRoot().append(paragraph);
      },
      { discrete: true }
    );
    expect(calls).toEqual([['plaintext', 'let a']]);
    expect(shape(editor)).toEqual([
      {
        type: 'code',
        children: [
          ['code-highlight', ' ', null],
          ['code-highlight', 'ab', 'word'],
        ],
      },
      { type: 'paragraph', children: [['text', 'let', null]] },
    ]);
  } finally {
    unregister();
  }
});
