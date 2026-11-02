import { $isListItemNode, $isListNode } from '@lexical/list';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from '@lexical/markdown';
import { $getRoot, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $isImageNode } from '../nodes/ImageNode';
import { EXTERNAL_TRANSFORMERS, INTERNAL_TRANSFORMERS } from '../transformers';

function roundTrip(markdown: string, transformers: Transformer[]) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, transformers);
    },
    { discrete: true }
  );
  return editor.getEditorState().read(() => {
    const root = $getRoot();
    const list = root.getFirstChild();
    const items = $isListNode(list) ? list.getChildren() : [];
    return {
      topLevelTypes: root.getChildren().map((node) => node.getType()),
      itemChildTypes: items.map((item) =>
        $isListItemNode(item)
          ? item.getChildren().map((child) => child.getType())
          : []
      ),
      values: items.map((item) =>
        $isListItemNode(item) ? item.getValue() : 0
      ),
      imageUrls: items.map((item) =>
        $isListItemNode(item)
          ? item
              .getChildren()
              .filter($isImageNode)
              .map((image) => image.getUrl())
          : []
      ),
      markdown: $convertToMarkdownString(transformers),
    };
  });
}

describe('images inside list items', () => {
  it('keeps a numbered list in one list with its numbering', () => {
    const markdown = [
      '1. first',
      '   ![diagram](https://example.com/a.png)',
      '2. second',
    ].join('\n');

    const result = roundTrip(markdown, EXTERNAL_TRANSFORMERS);

    expect(result.topLevelTypes).toEqual(['list']);
    expect(result.itemChildTypes).toEqual([['text', 'image'], ['text']]);
    expect(result.values).toEqual([1, 2]);
    expect(result.imageUrls).toEqual([['https://example.com/a.png'], []]);
    expect(result.markdown).toBe(markdown);
  });

  it('round-trips a resized image under a nested bullet', () => {
    const image =
      '<m-image>{"url":"https://example.com/b.png","alt":"","srcType":"sfs","id":"b","width":800,"height":600,"scale":1,"constrainedWidth":200}</m-image>';
    const markdown = ['- outer', '  - inner', `    ${image}`, '- next'].join(
      '\n'
    );

    const result = roundTrip(markdown, INTERNAL_TRANSFORMERS);

    expect(result.topLevelTypes).toEqual(['list']);
    expect(result.markdown).toBe(markdown);
  });

  it('keeps an unindented image after a list outside the list', () => {
    const markdown = ['- item', '![photo](https://example.com/c.png)'].join(
      '\n'
    );

    const result = roundTrip(markdown, EXTERNAL_TRANSFORMERS);

    expect(result.topLevelTypes).toEqual(['list', 'image']);
    expect(result.itemChildTypes).toEqual([['text']]);
  });
});
