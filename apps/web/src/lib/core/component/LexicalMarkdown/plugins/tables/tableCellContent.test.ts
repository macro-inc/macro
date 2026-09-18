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
import { Telemetry } from '@macro-inc/observability';
import { $createTextNode, type LexicalEditor } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
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

  it('wraps a stray text child in a paragraph and logs the document id', async () => {
    const error = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    const editor = createTableTestEditor({ documentId: 'doc-019ff75a' });
    await buildTable(editor, textGrid([['hello']]));

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          $getCell(0, 0).append($createTextNode('extra'));
        },
        { onUpdate: () => resolve() }
      );
    });

    editor.read(() => {
      const children = $getCell(0, 0).getChildren();
      expect(children.map((child) => child.getType())).toEqual([
        'paragraph',
        'paragraph',
      ]);
      expect($getCell(0, 0).getTextContent()).toContain('extra');
    });
    expect(error).toHaveBeenCalledWith(
      'table cell normalization salvaged stray children',
      expect.objectContaining({
        document_id: 'doc-019ff75a',
        salvaged_types: ['text'],
      })
    );
    error.mockRestore();
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
