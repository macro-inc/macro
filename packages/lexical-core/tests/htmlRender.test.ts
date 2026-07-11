import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $createQuoteNode } from '@lexical/rich-text';
import { $dfsIterator } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $createClassedBlockNode } from '../nodes/ClassedBlockNode';
import { $isHtmlRenderNode, HtmlRenderNode } from '../nodes/HtmlRenderNode';
import { INTERNAL_TRANSFORMERS } from '../transformers';

const QUOTED_HTML =
  '<table><tbody><tr><td><a href="https://example.com">Join</a> the meeting</td></tr></tbody></table>';

function $buildForwardEditorState() {
  const root = $getRoot();
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode('should i go'));
  root.append(paragraph);

  // Same shape the composer builds for a forward: quote wrapper containing
  // the header lines and a blockquote holding the rendered original email.
  const wrapper = $createClassedBlockNode({
    tag: 'div',
    classes: ['macro_quote', 'gmail_quote'],
  });
  const header = $createParagraphNode();
  header.append($createTextNode('---------- Forwarded message ----------'));
  wrapper.append(header);

  const quote = $createQuoteNode();
  quote.append(new HtmlRenderNode(QUOTED_HTML));
  wrapper.append(quote);
  root.append(wrapper);
}

describe('HtmlRenderNode - m-html-render transformer', () => {
  it('round-trips rendered email html nested in a forward quote', async () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: console.error,
    });

    await new Promise<void>((resolve) => {
      editor.update(() => $buildForwardEditorState(), {
        onUpdate: () => resolve(),
      });
    });

    let markdown = '';
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(INTERNAL_TRANSFORMERS);
    });

    // The quoted html must survive serialization (angle brackets escaped)
    expect(markdown).toContain('<m-html-render>');
    expect(markdown).toContain('</m-html-render>');
    expect(markdown).not.toContain('<table>');
    expect(markdown).toContain('\\u003ctable\\u003e');

    // Import back and verify the node is restored with the original html
    const editor2 = createEditor({
      nodes: SupportedNodeTypes,
      onError: console.error,
    });
    await new Promise<void>((resolve) => {
      editor2.update(
        () => $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS),
        { onUpdate: () => resolve() }
      );
    });

    editor2.getEditorState().read(() => {
      const htmlNodes = [];
      for (const { node } of $dfsIterator()) {
        if ($isHtmlRenderNode(node)) htmlNodes.push(node);
      }
      expect(htmlNodes).toHaveLength(1);
      expect(htmlNodes[0].exportComponentProps().html).toBe(QUOTED_HTML);
    });
  });
});
