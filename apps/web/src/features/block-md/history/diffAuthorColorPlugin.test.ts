/**
 * @vitest-environment jsdom
 */

import { $createDiffTextNode, DiffTextNode } from '@macro-inc/lexical-core';
import { $createParagraphNode, $getRoot, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { diffAuthorColorPlugin } from './diffAuthorColorPlugin';

describe('diffAuthorColorPlugin', () => {
  it('applies the app palette color to rendered diff text', () => {
    const editor = createEditor({
      namespace: 'diff-author-color-test',
      nodes: [DiffTextNode],
      onError: (error) => {
        throw error;
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    editor.setRootElement(root);
    const dispose = diffAuthorColorPlugin(editor);

    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append(
              $createDiffTextNode(
                'Changed text',
                'insert',
                'document-author-id'
              )
            )
          );
      },
      { discrete: true }
    );

    const diff = root.querySelector<HTMLElement>('[data-diff-author]');
    expect(diff?.dataset.diffAuthor).toBe('document-author-id');
    expect(diff?.style.getPropertyValue('--diff-author-color')).toBe(
      'var(--color-purple, var(--color-pink))'
    );

    dispose();
    editor.setRootElement(null);
    root.remove();
  });
});
