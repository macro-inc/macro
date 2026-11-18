import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import {
  $enterContinuesList,
  shouldInsertNewlineOnEnter,
} from './enterKeyUtils';

describe('shouldInsertNewlineOnEnter', () => {
  test('returns true for shift+enter', () => {
    expect(
      shouldInsertNewlineOnEnter({
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBe(true);
  });

  test('returns false for enter', () => {
    expect(
      shouldInsertNewlineOnEnter({
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      })
    ).toBe(false);
  });

  test('returns false for cmd+shift+enter', () => {
    expect(
      shouldInsertNewlineOnEnter({
        shiftKey: true,
        metaKey: true,
        ctrlKey: false,
      })
    ).toBe(false);
  });
});

const PLAIN = { metaKey: false, ctrlKey: false };

/** Whether Enter continues the list, with the caret at the end of `text`. */
function enterContinuesListAt(
  build: () => void,
  text: string,
  event = PLAIN
): boolean {
  const editor = createEditor({ nodes: [ListNode, ListItemNode] });
  let result = false;
  editor.update(
    () => {
      build();
      const target = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === text);
      target?.selectEnd();
      result = $enterContinuesList(event);
    },
    { discrete: true }
  );
  return result;
}

function $item(text: string) {
  return $createListItemNode().append($createTextNode(text));
}

describe('$enterContinuesList', () => {
  test.each(['bullet', 'number', 'check'] as const)(
    'is true in a %s item',
    (type) => {
      expect(
        enterContinuesListAt(
          () => $getRoot().append($createListNode(type).append($item('one'))),
          'one'
        )
      ).toBe(true);
    }
  );

  test('is true in a nested item', () => {
    expect(
      enterContinuesListAt(() => {
        const nested = $createListItemNode().append(
          $createListNode('bullet').append($item('two'))
        );
        $getRoot().append(
          $createListNode('bullet').append($item('one'), nested)
        );
      }, 'two')
    ).toBe(true);
  });

  test('is true in an empty item', () => {
    const editor = createEditor({ nodes: [ListNode, ListItemNode] });
    let result = false;
    editor.update(
      () => {
        const empty = $createListItemNode();
        $getRoot().append(
          $createListNode('bullet').append($item('one'), empty)
        );
        empty.select(0, 0);
        result = $enterContinuesList(PLAIN);
      },
      { discrete: true }
    );
    expect(result).toBe(true);
  });

  test('is false in a paragraph after a list', () => {
    expect(
      enterContinuesListAt(() => {
        $getRoot().append(
          $createListNode('bullet').append($item('one')),
          $createParagraphNode().append($createTextNode('after'))
        );
      }, 'after')
    ).toBe(false);
  });

  test.each([
    ['Cmd', { metaKey: true, ctrlKey: false }],
    ['Ctrl', { metaKey: false, ctrlKey: true }],
  ])('is false with %s held, so the composer sends', (_name, event) => {
    expect(
      enterContinuesListAt(
        () => $getRoot().append($createListNode('bullet').append($item('one'))),
        'one',
        event
      )
    ).toBe(false);
  });
});
