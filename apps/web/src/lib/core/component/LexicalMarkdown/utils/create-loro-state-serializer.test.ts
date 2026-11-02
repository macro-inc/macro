import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list';
import {
  $createCommentNode,
  $createCompletionNode,
  $createCustomCodeNode,
  $setId,
  CommentNode,
  CompletionNode,
  CustomCodeNode,
  stripDraftCommentMarks,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setState,
  createEditor,
  createState,
  type EditorState,
  type SerializedLexicalNode,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { createLoroStateSerializer } from './create-loro-state-serializer';

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  ENABLE_MARKDOWN_SEARCH_TEXT: true,
}));

// The canonical native export with the persistence transformations, independent
// of the incremental cache. Keep this oracle cold and mutable.
function coldExport(state: EditorState) {
  const result = state.toJSON();
  const searchText = state.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => node.getTextContent())
  );
  for (const [i, child] of result.root.children.entries()) {
    if (child.$?.id && 'children' in child)
      child.$ = { ...child.$, searchText: searchText[i] };
  }
  const clean = stripDraftCommentMarks(result);
  function removeCompletions(node: SerializedLexicalNode) {
    if (!('children' in node) || !Array.isArray(node.children)) return;
    const children = node.children.filter(
      (child) => child.type !== 'completion'
    );
    node.children = children;
    for (const child of children) removeCompletions(child);
  }
  removeCompletions(clean.root);
  return clean;
}

describe('provider-owned Loro serialization', () => {
  it('matches cold export while sharing unchanged frozen branches across edits, moves and undo', () => {
    const editor = createEditor();
    editor.update(
      () => {
        for (const [i, text] of ['first', 'second', 'third'].entries()) {
          const paragraph = $createParagraphNode().append(
            $createTextNode(text)
          );
          $setId(paragraph, `paragraph-${i}`);
          $getRoot().append(paragraph);
        }
      },
      { discrete: true }
    );
    const serialize = createLoroStateSerializer();
    const initialState = editor.getEditorState();
    const initial = serialize(initialState);
    expect(initial).toEqual(coldExport(initialState));
    // Mirror freezes accepted output. Neither later exports nor prior snapshots
    // may be changed by an edit or by reading an older editor state again.
    for (const paragraph of initial.root.children) {
      Object.freeze(paragraph.$);
      Object.freeze(paragraph);
      if ('children' in paragraph && Array.isArray(paragraph.children)) {
        for (const child of paragraph.children) Object.freeze(child);
        Object.freeze(paragraph.children);
      }
    }
    Object.freeze(initial.root.children);
    Object.freeze(initial.root);
    editor.update(
      () => {
        const paragraph = $getRoot().getChildAtIndex(1);
        const text = $isElementNode(paragraph)
          ? paragraph.getFirstChild()
          : null;
        if ($isTextNode(text)) text.setTextContent('edited second');
      },
      { discrete: true }
    );
    const edited = serialize(editor.getEditorState());
    expect(edited).toEqual(coldExport(editor.getEditorState()));
    expect(edited.root.children[0]).toBe(initial.root.children[0]);
    expect(edited.root.children[1]).not.toBe(initial.root.children[1]);
    expect(edited.root.children[2]).toBe(initial.root.children[2]);
    editor.update(
      () => {
        const root = $getRoot();
        const last = root.getLastChild();
        if (last) root.getFirstChild()?.insertBefore(last);
        root.getLastChild()?.remove();
        root.append($createParagraphNode().append($createTextNode('added')));
      },
      { discrete: true }
    );
    expect(serialize(editor.getEditorState())).toEqual(
      coldExport(editor.getEditorState())
    );
    editor.setEditorState(initialState);
    expect(serialize(editor.getEditorState())).toEqual(initial);
    expect(serialize(initialState)).toEqual(coldExport(initialState));
  });

  it('flattens draft marks, omits completions and refreshes raw search text when omitted content changes', () => {
    const editor = createEditor({ nodes: [CommentNode, CompletionNode] });
    editor.update(
      () => {
        const paragraph = $createParagraphNode().append(
          $createTextNode('before '),
          $createCommentNode({ ids: ['draft'], isDraft: true }).append(
            $createTextNode('draft text')
          ),
          $createCommentNode({ ids: ['posted'], isDraft: false }).append(
            $createTextNode('posted text')
          ),
          $createCompletionNode([$createTextNode('suggestion')])
        );
        $setId(paragraph, 'paragraph');
        $getRoot().append(paragraph);
      },
      { discrete: true }
    );
    const serialize = createLoroStateSerializer();
    const first = serialize(editor.getEditorState());
    expect(first).toEqual(coldExport(editor.getEditorState()));
    expect(JSON.stringify(first)).not.toContain('"completion"');
    expect(JSON.stringify(first)).not.toContain('"draft"');
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        const completion = $isElementNode(paragraph)
          ? paragraph.getLastChild()
          : null;
        const text = $isElementNode(completion)
          ? completion.getFirstChild()
          : null;
        if ($isTextNode(text)) text.setTextContent('different suggestion');
      },
      { discrete: true }
    );
    const second = serialize(editor.getEditorState());
    expect(second).toEqual(coldExport(editor.getEditorState()));
    expect(second.root.children[0].$?.searchText).not.toBe(
      first.root.children[0].$?.searchText
    );
  });
  it('matches native exports for nested lists, code and custom node state', () => {
    const metadata = createState('serialization-test', {
      parse: (value) => (typeof value === 'string' ? value : ''),
    });
    const editor = createEditor({
      nodes: [ListNode, ListItemNode, CustomCodeNode],
    });
    editor.update(
      () => {
        const nested = $createListNode('bullet').append(
          $createListItemNode().append($createTextNode('nested'))
        );
        const list = $createListNode('number').append(
          $createListItemNode().append($createTextNode('outer'), nested)
        );
        $setId(list, 'list');
        const code = $createCustomCodeNode('typescript').append(
          $createTextNode('const value = 1;')
        );
        $setId(code, 'code');
        $setState(code, metadata, 'first');
        $getRoot().append(list, code);
      },
      { discrete: true }
    );
    const serialize = createLoroStateSerializer();
    const initial = serialize(editor.getEditorState());
    expect(initial).toEqual(coldExport(editor.getEditorState()));
    editor.update(
      () => {
        const code = $getRoot().getLastChild();
        if (!code) return;
        $setState(code, metadata, 'changed');
        if ($isElementNode(code)) {
          const text = code.getFirstChild();
          if ($isTextNode(text)) text.setTextContent('const value = 2;');
        }
      },
      { discrete: true }
    );
    const edited = serialize(editor.getEditorState());
    expect(edited).toEqual(coldExport(editor.getEditorState()));
    expect(edited.root.children[0]).toBe(initial.root.children[0]);
    expect(edited.root.children[1]).not.toBe(initial.root.children[1]);
  });
});
