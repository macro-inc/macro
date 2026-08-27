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
import type { LexicalEditor } from 'lexical';
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
