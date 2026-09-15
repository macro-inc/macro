import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createHasLineBreaks } from './create-has-line-breaks';

describe('composer line breaks', () => {
  it('expands for blank paragraphs and collapses when they are removed', () => {
    createRoot((dispose) => {
      const editor = createEditor();
      const hasLineBreaks = createHasLineBreaks(editor);
      editor.update(() => $getRoot().append($createParagraphNode()), {
        discrete: true,
      });
      expect(hasLineBreaks()).toBe(false);
      editor.update(() => $getRoot().append($createParagraphNode()), {
        discrete: true,
      });
      expect(hasLineBreaks()).toBe(true);
      editor.update(() => $getRoot().clear().append($createParagraphNode()), {
        discrete: true,
      });
      expect(hasLineBreaks()).toBe(false);
      dispose();
    });
  });

  it('detects a trailing soft break before another character is typed', () => {
    createRoot((dispose) => {
      const editor = createEditor();
      const hasLineBreaks = createHasLineBreaks(editor);
      editor.update(
        () =>
          $getRoot().append(
            $createParagraphNode().append(
              $createTextNode('Hello'),
              $createLineBreakNode()
            )
          ),
        { discrete: true }
      );
      expect(hasLineBreaks()).toBe(true);
      dispose();
    });
  });
});
