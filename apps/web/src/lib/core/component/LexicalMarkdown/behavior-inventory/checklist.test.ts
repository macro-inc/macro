import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
} from '@lexical/list';
import { $createTextNode, $getRoot, KEY_ENTER_COMMAND } from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checklistPlugin } from '../plugins/checklist/checklistPlugin';
import { behaviorEditor } from './editor';

const PLATFORM = vi.hoisted(() => ({ mac: false }));
vi.mock('@core/constant/isMac', () => ({
  get IS_MAC() {
    return PLATFORM.mac;
  },
}));
afterEach(() => vi.restoreAllMocks());

describe('platform checklist shortcuts', () => {
  for (const platform of ['Mac', 'Windows', 'Linux']) {
    it.each([true, false])(
      `${platform}: modifier+Enter aligns mixed checks opposite to the first (%s)`,
      (checked) => {
        PLATFORM.mac = platform === 'Mac';
        const { editor } = behaviorEditor(checklistPlugin());
        editor.update(
          () => {
            const first = $createTextNode('first');
            const second = $createTextNode('second');
            $getRoot().append(
              $createListNode('check').append(
                $createListItemNode(checked).append(first),
                $createListItemNode(!checked).append(second)
              )
            );
            const selection = first.select(0, 0);
            selection.focus.set(second.getKey(), 6, 'text');
            expect(
              editor.dispatchCommand(
                KEY_ENTER_COMMAND,
                new KeyboardEvent('keydown', {
                  key: 'Enter',
                  metaKey: PLATFORM.mac,
                  ctrlKey: !PLATFORM.mac,
                })
              )
            ).toBe(true);
          },
          { discrete: true }
        );
        editor.read(() => {
          const list = $getRoot().getFirstChild();
          if (!$isListNode(list)) throw new Error('Expected checklist');
          const items = list.getChildren().filter($isListItemNode);
          expect(items?.map((item) => item.getChecked())).toEqual([
            !checked,
            !checked,
          ]);
        });
      }
    );

    it(`${platform}: Shift+modifier+Enter stays with the host`, () => {
      PLATFORM.mac = platform === 'Mac';
      const { editor } = behaviorEditor(checklistPlugin());
      expect(
        editor.dispatchCommand(
          KEY_ENTER_COMMAND,
          new KeyboardEvent('keydown', {
            key: 'Enter',
            metaKey: PLATFORM.mac,
            ctrlKey: !PLATFORM.mac,
            shiftKey: true,
          })
        )
      ).toBe(false);
    });
  }
});

describe('checklist pointer hit testing', () => {
  it.each([
    { editable: true, delta: 0, targetX: 95, toggles: true },
    { editable: true, delta: 4, targetX: 95, toggles: true },
    { editable: true, delta: 5, targetX: 95, toggles: false },
    { editable: true, delta: 12, targetX: 95, toggles: false },
    { editable: true, delta: 0, targetX: 160, toggles: false },
    { editable: false, delta: 0, targetX: 95, toggles: false },
  ])(
    'checks editability=$editable, drag=$delta, x=$targetX',
    ({ editable, delta, targetX, toggles }) => {
      const { editor, root } = behaviorEditor(checklistPlugin());
      document.documentElement.style.fontSize = '16px';
      editor.update(
        () => {
          $getRoot().append(
            $createListNode('check').append(
              $createListItemNode(false).append($createTextNode('item'))
            )
          );
        },
        { discrete: true }
      );
      editor.setEditable(editable);
      const item = root.querySelector('li');
      if (!item) throw new Error('Expected rendered list item');
      vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(100, 100, 300, 30)
      );
      const down = new MouseEvent('pointerdown', {
        clientX: targetX,
        clientY: 105,
        bubbles: true,
        cancelable: true,
      });
      item.dispatchEvent(down);
      item.dispatchEvent(
        new MouseEvent('click', {
          clientX: targetX + delta,
          clientY: 105,
          bubbles: true,
        })
      );
      editor.read(() => {
        const list = $getRoot().getFirstChild();
        if (!$isListNode(list)) throw new Error('Expected checklist');
        const node = list.getFirstChild();
        expect($isListItemNode(node)).toBe(true);
        if (!$isListItemNode(node)) throw new Error('Expected checklist item');
        expect(node.getChecked()).toBe(toggles);
      });
      expect(down.defaultPrevented).toBe(editable && targetX === 95);
      expect(item.hasAttribute('tabindex')).toBe(false);
      expect(item.getAttribute('role')).toBe('checkbox');
      expect(item.getAttribute('aria-checked')).toBe(String(toggles));
      document.documentElement.style.removeProperty('font-size');
    }
  );
});
