import { $createClassedBlockNode } from '@macro-inc/lexical-core';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { createEmailEditor } from '../tests/editor';
import { createWrittenText } from './written-text';

it('follows what the user writes and leaves out the quoted thread', () => {
  const editor = createEmailEditor('Want to meet');
  editor.update(
    () => {
      const quote = $createClassedBlockNode({
        tag: 'div',
        classes: ['macro_quote', 'gmail_quote'],
      });
      quote.append(
        $createParagraphNode().append($createTextNode('Lunch tomorrow at 1pm?'))
      );
      $getRoot().append(quote);
    },
    { discrete: true }
  );

  const [text, dispose] = createRoot((dispose) => [
    createWrittenText(() => editor),
    dispose,
  ]);
  expect(text()).toBe('Want to meet');

  editor.update(
    () => {
      $getRoot().getFirstChildOrThrow().selectEnd().insertText(' Friday?');
    },
    { discrete: true }
  );
  expect(text()).toBe('Want to meet Friday?');
  dispose();
});
