import { $createLinkNode } from '@lexical/link';
import {
  $createListItemNode,
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  registerList,
} from '@lexical/list';
import {
  $createTableNode,
  $createTableRowNode,
  $isTableNode,
} from '@lexical/table';
import {
  $createDateMentionNode,
  $isDateMentionNode,
} from '@macro-inc/lexical-core/nodes/DateMentionNode';
import {
  $createImageNode,
  $isImageNode,
} from '@macro-inc/lexical-core/nodes/ImageNode';
import {
  $isTaskListNode,
  TaskListNode,
} from '@macro-inc/lexical-core/nodes/TaskListNode';
import {
  $createVideoNode,
  $isVideoNode,
} from '@macro-inc/lexical-core/nodes/VideoNode';
import { $createTextNode, $isElementNode, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  $createTextCell,
  $getCell,
  buildTable,
  createTableTestEditor,
  placeCaret,
  textGrid,
} from './tableTestUtils';

function createTableEditor(): LexicalEditor {
  return createTableTestEditor();
}

describe('table cell allowed content', () => {
  it('preserves stray text and inline links in paragraphs, in order', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid([['hello']]));
    let textKey = '';
    let linkKey = '';
    editor.update(
      () => {
        const text = $createTextNode('stray text');
        const link = $createLinkNode('https://example.com');
        link.append($createTextNode('linked text'));
        textKey = text.getKey();
        linkKey = link.getKey();
        $getCell(0, 0).append(text, link);
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getCell(0, 0).getChildren();
      expect(children.map((child) => child.getType())).toEqual([
        'paragraph',
        'paragraph',
        'paragraph',
      ]);
      expect(children.map((child) => child.getTextContent())).toEqual([
        'hello',
        'stray text',
        'linked text',
      ]);
      expect(
        $isElementNode(children[1]) && children[1].getFirstChild()?.getKey()
      ).toBe(textKey);
      expect(
        $isElementNode(children[2]) && children[2].getFirstChild()?.getKey()
      ).toBe(linkKey);
    });
  });

  it('keeps a date mention appended to a table cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid([['hello']]));
    let mentionKey = '';

    editor.update(
      () => {
        const mention = $createDateMentionNode({
          date: '2026-03-24T00:00:00.000Z',
          displayFormat: 'March 24, 2026',
        });
        mentionKey = mention.getKey();
        $getCell(0, 0).append(mention);
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getCell(0, 0).getChildren();
      expect(children.map((child) => child.getType())).toEqual([
        'paragraph',
        'paragraph',
      ]);
      const mention = $isElementNode(children[1])
        ? children[1].getChildren().find($isDateMentionNode)
        : undefined;
      expect(mention?.getKey()).toBe(mentionKey);
      expect(mention?.getDate()).toBe('2026-03-24T00:00:00.000Z');
      expect(mention?.getDisplayFormat()).toBe('March 24, 2026');
    });
  });

  it('keeps an image appended to a table cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid([['hello']]));

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          $getCell(0, 0).append(
            $createImageNode({
              srcType: 'url',
              url: 'https://example.com/cat.png',
              alt: 'cat',
            })
          );
        },
        { onUpdate: () => resolve() }
      );
    });

    editor.read(() => {
      const image = $getCell(0, 0).getChildren().find($isImageNode);
      expect(image).toBeDefined();
      expect(image?.getUrl()).toBe('https://example.com/cat.png');
      expect(image?.getAlt()).toBe('cat');
    });
  });

  it('keeps a video appended to a table cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid([['hello']]));

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          $getCell(0, 0).append(
            $createVideoNode({
              srcType: 'url',
              url: 'https://example.com/clip.mp4',
            })
          );
        },
        { onUpdate: () => resolve() }
      );
    });

    editor.read(() => {
      const video = $getCell(0, 0).getChildren().find($isVideoNode);
      expect(video).toBeDefined();
      expect(video?.getUrl()).toBe('https://example.com/clip.mp4');
    });
  });

  it.each(['bullet', 'number', 'check'] as const)(
    'keeps a %s list appended to a table cell',
    async (listType) => {
      const editor = createTableEditor();
      await buildTable(editor, textGrid([['hello']]));

      await new Promise<void>((resolve) => {
        editor.update(
          () => {
            const list = new TaskListNode(listType);
            const item = $createListItemNode();
            item.append($createTextNode('item'));
            list.append(item);
            $getCell(0, 0).append(list);
          },
          { onUpdate: () => resolve() }
        );
      });

      editor.read(() => {
        const list = $getCell(0, 0).getChildren().find($isTaskListNode);
        expect(list).toBeDefined();
        expect(list?.getListType()).toBe(listType);
        expect(list?.getTextContent()).toBe('item');
      });
    }
  );

  it.each([
    ['bullet', INSERT_UNORDERED_LIST_COMMAND],
    ['number', INSERT_ORDERED_LIST_COMMAND],
  ] as const)(
    'keeps cell text when converting a paragraph to a %s list',
    async (listType, command) => {
      const editor = createTableEditor();
      registerList(editor);
      await buildTable(editor, textGrid([['keep me']]));
      await placeCaret(editor, 'keep me');

      editor.dispatchCommand(command, undefined);
      await Promise.resolve();

      editor.read(() => {
        const list = $getCell(0, 0).getChildren().find($isListNode);
        expect(list).toBeDefined();
        expect(list?.getListType()).toBe(listType);
        expect($getCell(0, 0).getTextContent()).toBe('keep me');
      });
    }
  );

  it('still strips nested tables from cells', async () => {
    const editor = createTableEditor();
    await buildTable(editor, textGrid([['hello']]));

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const nested = $createTableNode();
          const row = $createTableRowNode();
          row.append($createTextCell('inner'));
          nested.append(row);
          $getCell(0, 0).append(nested);
        },
        { onUpdate: () => resolve() }
      );
    });

    editor.read(() => {
      expect($getCell(0, 0).getChildren().some($isTableNode)).toBe(false);
    });
  });
});
