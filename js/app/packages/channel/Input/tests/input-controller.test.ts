/**
 * @vitest-environment jsdom
 */

import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { LexicalEditor } from 'lexical';
import { createInputController } from '../input-controller';

const { initializeEditorEmptyMock } = vi.hoisted(() => ({
  initializeEditorEmptyMock: vi.fn(),
}));

vi.mock('@core/component/LexicalMarkdown/utils', () => ({
  editorStateAsMarkdown: (editorState: { markdown?: string }) =>
    editorState.markdown ?? '',
  initializeEditorEmpty: initializeEditorEmptyMock,
}));

describe('createInputController', () => {
  it('reads markdown from lexical updates and mentions from external source', () => {
    createRoot((dispose) => {
      type UpdateListener = Parameters<
        LexicalEditor['registerUpdateListener']
      >[0];
      let listener: UpdateListener | undefined;

      const lexicalEditor = {
        registerUpdateListener: (nextListener: UpdateListener) => {
          listener = nextListener;
          return () => {};
        },
      } as unknown as LexicalEditor;

      const [mentions, setMentions] = createSignal<ItemMention[]>([]);

      const controller = createInputController({
        initialValue: 'initial',
        lexicalEditor,
        mentions,
      });

      expect(controller.value()).toBe('initial');
      expect(controller.mentions()).toEqual([]);

      listener?.({ editorState: { markdown: 'next markdown' } } as never);
      expect(controller.value()).toBe('next markdown');

      setMentions([
        {
          itemType: 'user',
          itemId: 'u1',
        },
      ]);
      expect(controller.mentions()).toEqual([
        {
          itemType: 'user',
          itemId: 'u1',
        },
      ]);

      controller.clear();
      expect(controller.value()).toBe('');
      expect(initializeEditorEmptyMock).toHaveBeenCalledWith(lexicalEditor);

      dispose();
    });
  });

  it('unregisters lexical update listener on cleanup', () => {
    const unsubscribe = vi.fn();

    createRoot((dispose) => {
      type UpdateListener = Parameters<
        LexicalEditor['registerUpdateListener']
      >[0];
      const lexicalEditor = {
        registerUpdateListener: (_nextListener: UpdateListener) => unsubscribe,
      } as unknown as LexicalEditor;

      createInputController({
        lexicalEditor,
      });

      dispose();
    });

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
