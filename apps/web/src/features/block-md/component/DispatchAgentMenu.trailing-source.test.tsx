import { writeFileSync } from 'node:fs';
import { behaviorEditor } from '@core/component/LexicalMarkdown/behavior-inventory/editor';
import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { trailingParagraphPlugin } from '@core/component/LexicalMarkdown/plugins/trailing-paragraph/trailingParagraphPlugin';
import {
  editorStateAsMarkdown,
  initializeEditorWithVersionedState,
} from '@core/component/LexicalMarkdown/utils';
import { $createCodeNode, $isCodeNode } from '@lexical/code';
import { $createTextNode, $getRoot } from 'lexical';
import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';

it('runs the actual Source code trailing transform through versioned document load', () => {
  const seedEditor = behaviorEditor();
  seedEditor.editor.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createCodeNode('rust').append($createTextNode('let value = 1;'))
        );
      expect($isCodeNode($getRoot().getLastChild())).toBe(true);
    },
    { discrete: true }
  );
  const seed = seedEditor.editor.getEditorState().toJSON();
  expect(seed.root.children.map((node) => node.type)).toEqual(['custom-code']);
  const evidence: object[] = [];
  for (const trailing of [false, true]) {
    createRoot((dispose) => {
      const wrapper = createLexicalWrapper({
        type: 'markdown-sync',
        namespace: 'prompt-load-source-control',
        isInteractable: () => true,
        withIds: true,
      });
      const { editor, plugins } = wrapper;
      if (trailing) plugins.use(trailingParagraphPlugin());
      const root = document.createElement('div');
      root.contentEditable = 'true';
      document.body.append(root);
      editor.setRootElement(root);
      const commits: object[] = [];
      const release = editor.registerUpdateListener(({ editorState }) => {
        commits.push(editorState.toJSON());
      });
      try {
        const result = initializeEditorWithVersionedState(editor, seed);
        expect(result).toBeNull();
        // Flush the real load's pending identity-command update, without adding
        // a fixture update, manually marking a node dirty or changing the model.
        const postLoad = editor.read(() => $getRoot().exportJSON());
        const state = editor.getEditorState().toJSON();
        const markdown = editorStateAsMarkdown(editor, 'external');
        evidence.push({ trailing, seed, postLoad, state, commits, markdown });
        expect(state.root.children.map((node) => node.type)).toEqual(
          trailing ? ['custom-code', 'paragraph'] : ['custom-code']
        );
        expect(markdown).toBe(
          trailing
            ? '```rust\nlet value = 1;\n```\n'
            : '```rust\nlet value = 1;\n```'
        );
        if (trailing)
          editor.read(() =>
            expect($getRoot().getLastChild()?.getTextContent()).toBe('')
          );
      } finally {
        release();
        wrapper.cleanup();
        editor.setRootElement(null);
        root.remove();
        dispose();
      }
    });
  }
  const out = process.env.DISPATCH_TRAILING_EVIDENCE;
  if (out)
    writeFileSync(
      out,
      JSON.stringify(
        {
          qualification:
            'Attached actual Source markdown-sync wrapper defaults + nodeId + optional real trailing plugin; actual production versioned load helper and its real pending identity command; not full app/provider proof',
          evidence,
        },
        null,
        2
      ) + '\n',
      { flag: 'wx', mode: 0o600 }
    );
});
