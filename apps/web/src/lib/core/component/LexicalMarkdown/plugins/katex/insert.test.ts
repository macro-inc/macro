/** @vitest-environment jsdom */
import { EquationNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  createEditor,
} from 'lexical';
import { expect, test } from 'vitest';
import { INSERT_EQUATION_COMMAND, katexPlugin } from './katexPlugin';

for (const inline of [true, false]) {
  for (const mode of ['collapsed', 'expanded', 'previous'] as const) {
    test(`actual Source equation insertion ${mode} inline=${inline} preserves text and caret`, () => {
      const editor = createEditor({
        nodes: [EquationNode],
        onError(error) {
          throw error;
        },
      });
      const cleanup = katexPlugin({})(editor);
      try {
        editor.update(
          () => {
            const text = $createTextNode(
              mode === 'expanded' ? 'beforeCUTafter' : 'beforeafter'
            );
            $getRoot().append($createParagraphNode().append(text));
            const selected = text.select(6, mode === 'expanded' ? 9 : 6);
            // Real reads can populate the selection cache before it is frozen.
            if (mode === 'previous') selected.isBackward();
          },
          { discrete: true }
        );
        editor.update(
          () => {
            if (mode === 'previous') $setSelection(null);
            expect(
              editor.dispatchCommand(INSERT_EQUATION_COMMAND, {
                equation: 'x^2',
                inline,
              })
            ).toBe(true);
          },
          { discrete: true }
        );
        expect(editor.getEditorState().toJSON().root.children[0]).toEqual({
          children: [
            {
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text: 'before',
              type: 'text',
              version: 1,
            },
            { type: 'equation', version: 1, equation: 'x^2', inline },
            {
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text: 'after',
              type: 'text',
              version: 1,
            },
          ],
          direction: null,
          format: '',
          indent: 0,
          type: 'paragraph',
          version: 1,
          textFormat: 0,
          textStyle: '',
        });
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection))
            throw new Error('Missing actual inserted range');
          expect(selection.isCollapsed()).toBe(true);
          expect(selection.anchor.getNode().getTextContent()).toBe('after');
          expect(selection.anchor.offset).toBe(0);
        });
      } finally {
        cleanup();
      }
    });
  }
}

test('actual Source inserts an empty equation at root end without a selection', () => {
  const editor = createEditor({
    nodes: [EquationNode],
    onError(error) {
      throw error;
    },
  });
  const cleanup = katexPlugin({})(editor);
  try {
    editor.update(
      () => {
        expect(
          editor.dispatchCommand(INSERT_EQUATION_COMMAND, {
            equation: '',
            inline: true,
          })
        ).toBe(true);
      },
      { discrete: true }
    );
    expect(editor.getEditorState().toJSON().root.children[0]).toEqual({
      children: [{ type: 'equation', version: 1, equation: '', inline: true }],
      direction: null,
      format: '',
      indent: 0,
      type: 'paragraph',
      version: 1,
      textFormat: 0,
      textStyle: '',
    });
  } finally {
    cleanup();
  }
});
