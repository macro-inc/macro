import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  KEY_DOWN_COMMAND,
} from 'lexical';
import { expect, test } from 'vitest';
import { $handleKeyDown } from './events';

test('real upstream model commits through the selected DOM reconciler', () => {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  if (process.env.COMPAT_BASELINE !== 'upstream')
    expect([...(editor._commands.get(KEY_DOWN_COMMAND)?.[0] ?? [])]).toContain(
      $handleKeyDown
    );
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  editor.setRootElement(root);
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('hello'))
      );
    },
    { discrete: true }
  );
  expect(root.innerHTML).toBe(
    '<p dir="auto"><span data-lexical-text="true">hello</span></p>'
  );
  editor.setRootElement(null);
  root.remove();
});
