import { $createLinkNode } from '@lexical/link';
import {
  $createTableNode,
  $createTableRowNode,
  $isTableNode,
} from '@lexical/table';
import {
  $createImageNode,
  $isImageNode,
} from '@macro-inc/lexical-core/nodes/ImageNode';
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
