import { createRoot } from 'solid-js';
import { expect, test } from 'vitest';
import { allocateEditorNamespace } from './editor-namespace';
import { createLexicalWrapper } from './LexicalWrapperContext';

test('actual source wrappers and native callers share one namespace sequence', () => {
  const title = allocateEditorNamespace('block-md-title');
  createRoot((dispose) => {
    const sourceBody = createLexicalWrapper({
      type: 'markdown',
      namespace: 'block-md-main',
      isInteractable: () => true,
    });
    try {
      expect(title).toBe('block-md-title_1');
      expect(sourceBody.editor._config.namespace).toBe('block-md-main_2');
      expect(allocateEditorNamespace('block-md-main')).toBe('block-md-main_3');
    } finally {
      sourceBody.cleanup();
      dispose();
    }
  });
});
