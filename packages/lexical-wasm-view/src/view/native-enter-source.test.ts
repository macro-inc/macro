import { createEditor, KEY_ENTER_COMMAND } from 'lexical';
import { expect, test } from 'vitest';

test('Source Enter duplicate registration retains order and either cleanup removes it', () => {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  const order: string[] = [];
  const first = () => {
    order.push('first');
    return false;
  };
  const later = () => {
    order.push('later');
    return false;
  };
  const removeFirst = editor.registerCommand(KEY_ENTER_COMMAND, first, 2);
  const removeLater = editor.registerCommand(KEY_ENTER_COMMAND, later, 2);
  const removeDuplicate = editor.registerCommand(KEY_ENTER_COMMAND, first, 2);
  editor.dispatchCommand(KEY_ENTER_COMMAND, null);
  expect(order).toEqual(['first', 'later']);
  order.length = 0;
  removeDuplicate();
  editor.dispatchCommand(KEY_ENTER_COMMAND, null);
  expect(order).toEqual(['later']);
  const removeReadded = editor.registerCommand(KEY_ENTER_COMMAND, first, 2);
  order.length = 0;
  editor.dispatchCommand(KEY_ENTER_COMMAND, null);
  expect(order).toEqual(['later', 'first']);
  // The old cleanup still closes over the same live priority collection.
  removeFirst();
  order.length = 0;
  editor.dispatchCommand(KEY_ENTER_COMMAND, null);
  expect(order).toEqual(['later']);
  removeReadded();
  removeLater();
});

test('Source Enter snapshot keeps a removed and readded later callback', () => {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  const order: string[] = [];
  const later = () => {
    order.push('later');
    return false;
  };
  let removeLater = () => {};
  const removeFirst = editor.registerCommand(
    KEY_ENTER_COMMAND,
    () => {
      order.push('first');
      removeLater();
      removeLater = editor.registerCommand(KEY_ENTER_COMMAND, later, 2);
      return false;
    },
    2
  );
  removeLater = editor.registerCommand(KEY_ENTER_COMMAND, later, 2);
  editor.dispatchCommand(KEY_ENTER_COMMAND, null);
  expect(order).toEqual(['first', 'later']);
  order.length = 0;
  editor.dispatchCommand(KEY_ENTER_COMMAND, null);
  expect(order).toEqual(['first', 'later']);
  removeFirst();
  removeLater();
});

test('Source stale cleanup can remove a recreated empty command map', () => {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  const order: string[] = [];
  const removeFirst = editor.registerCommand(
    KEY_ENTER_COMMAND,
    () => {
      order.push('first');
      return false;
    },
    2
  );
  removeFirst();
  const removeLater = editor.registerCommand(
    KEY_ENTER_COMMAND,
    () => {
      order.push('later');
      return false;
    },
    2
  );
  removeFirst();
  editor.dispatchCommand(KEY_ENTER_COMMAND, null);
  expect(order).toEqual([]);
  removeLater();
});
