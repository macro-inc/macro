/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { buildEditorFromExtensions, defineExtension } from '@lexical/extension';
import { RichTextExtension } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type ParagraphNode,
} from 'lexical';
import { describe, expect, test } from 'vitest';

describe('setElementIndent', () => {
  test('emits a CSS variable reference rather than a pre-resolved value', () => {
    using editor = buildEditorFromExtensions(
      RichTextExtension,
      defineExtension({
        $initialEditorState: () => {
          const para = $createParagraphNode().append($createTextNode('hello'));
          para.setIndent(3);
          $getRoot().clear().append(para);
        },
        name: 'set-element-indent-var',
      })
    );
    editor.setRootElement(document.createElement('div'));

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow<ParagraphNode>();
      const dom = editor.getElementByKey(para.getKey());
      // The resolved CSS variable would only cascade after the element is
      // attached and styled. Emitting `var(...)` defers resolution to the
      // browser, so the inline style works regardless of where
      // `--lexical-indent-base-value` is defined or whether the element is
      // mounted at the time `setElementIndent` runs.
      expect(dom!.style.paddingInlineStart).toBe(
        'calc(3 * var(--lexical-indent-base-value, 40px))'
      );
    });
  });

  test('clears padding when indent returns to 0', () => {
    using editor = buildEditorFromExtensions(
      RichTextExtension,
      defineExtension({
        $initialEditorState: () => {
          const para = $createParagraphNode().append($createTextNode('hello'));
          para.setIndent(2);
          $getRoot().clear().append(para);
        },
        name: 'set-element-indent-clear',
      })
    );
    editor.setRootElement(document.createElement('div'));

    editor.update(
      () => {
        const para = $getRoot().getFirstChildOrThrow<ParagraphNode>();
        para.setIndent(0);
      },
      { discrete: true }
    );

    editor.read(() => {
      const para = $getRoot().getFirstChildOrThrow<ParagraphNode>();
      const dom = editor.getElementByKey(para.getKey());
      expect(dom!.style.paddingInlineStart).toBe('');
    });
  });
});
