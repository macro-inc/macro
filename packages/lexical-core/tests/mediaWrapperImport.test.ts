// @vitest-environment jsdom
import { $generateNodesFromDOM } from '@lexical/html';
import { $getRoot, createEditor, type LexicalNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $isImageNode } from '../nodes/ImageNode';

const IMG =
  '<img src="https://example.com/x.png" width="10" height="10" data-src-type="sfs" data-image-id="img-1">';

function importHtml(html: string) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (e) => {
      throw e;
    },
  });
  editor.update(() => {
    const dom = new DOMParser().parseFromString(html, 'text/html');
    const nodes = $generateNodesFromDOM(editor, dom);
    const root = $getRoot();
    root.clear();
    root.append(...nodes);
  });
  return editor;
}

function $collectImages(): LexicalNode[] {
  const found: LexicalNode[] = [];
  const visit = (node: LexicalNode) => {
    if ($isImageNode(node)) found.push(node);
    if ('getChildren' in node) {
      for (const child of (node as any).getChildren()) visit(child);
    }
  };
  for (const child of $getRoot().getChildren()) visit(child);
  return found;
}

describe('media wrapper div import', () => {
  it('imports the exported wrapper shape (<div><img/></div>) as an image', () => {
    const editor = importHtml(`<body><div>${IMG}</div></body>`);
    editor.read(() => {
      expect($collectImages()).toHaveLength(1);
    });
  });

  it('does not collapse a div holding an image plus other content', () => {
    const editor = importHtml(`<body><div>hello there ${IMG}</div></body>`);
    editor.read(() => {
      expect($collectImages()).toHaveLength(1);
      expect($getRoot().getTextContent()).toContain('hello there');
    });
  });

  it('does not steal an ancestor container with a nested image', () => {
    const editor = importHtml(
      `<body><div data-classed-block="true" class="macro_quote gmail_quote"><div class="gmail_attr" data-classed-block="true">On ... wrote:</div><div>${IMG}</div><blockquote>quoted text</blockquote></div></body>`
    );
    editor.read(() => {
      expect($collectImages()).toHaveLength(1);
      expect($getRoot().getTextContent()).toContain('quoted text');
      expect($getRoot().getTextContent()).toContain('On ... wrote:');
    });
  });
});
