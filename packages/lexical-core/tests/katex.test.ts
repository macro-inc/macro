import { $convertFromMarkdownString } from '@lexical/markdown';
import { $getRoot, $isParagraphNode, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $isEquationNode, type EquationNode } from '../nodes/EquationNode';
import { ALL_TRANSFORMERS } from '../transformers';

async function importMarkdown(markdown: string) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });

  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
      },
      { onUpdate: () => resolve() }
    );
  });

  return editor;
}

function firstEquation(): EquationNode {
  const root = $getRoot();
  for (const child of root.getChildren()) {
    if ($isEquationNode(child)) return child;
    if ($isParagraphNode(child)) {
      for (const paragraphChild of child.getChildren()) {
        if ($isEquationNode(paragraphChild)) return paragraphChild;
      }
    }
  }
  throw new Error('expected an equation node');
}

describe('equation markdown import', () => {
  it('treats $$...$$ as display math', async () => {
    const editor = await importMarkdown('$$ x = \\frac{1}{2} $$');
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getEquation().trim()).toBe('x = \\frac{1}{2}');
      expect(node.getInline()).toBe(false);
    });
  });

  it('treats $...$ as inline math', async () => {
    const editor = await importMarkdown('The result is $a + b$.');
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getEquation()).toBe('a + b');
      expect(node.getInline()).toBe(true);
    });
  });

  it('parses TeX-style inline math from coding-agent replies', async () => {
    const editor = await importMarkdown('The result is \\( a + b \\).');
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getEquation().trim()).toBe('a + b');
      expect(node.getInline()).toBe(true);
    });
  });

  it('parses TeX-style display math from coding-agent replies', async () => {
    const editor = await importMarkdown('\\[ E = mc^2 \\]');
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getEquation().trim()).toBe('E = mc^2');
      expect(node.getInline()).toBe(false);
    });
  });

  it('parses multiline $$ blocks as display math', async () => {
    const editor = await importMarkdown('$$\nE = mc^2\n$$');
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getEquation()).toBe('E = mc^2');
      expect(node.getInline()).toBe(false);
    });
  });

  it('parses multiline \\[ \\] blocks as display math', async () => {
    const editor = await importMarkdown('\\[\nE = mc^2\n\\]');
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getEquation()).toBe('E = mc^2');
      expect(node.getInline()).toBe(false);
    });
  });

  it('still imports internal katex XML tags', async () => {
    const editor = await importMarkdown(
      '<m-katex-equation>{"equation":"E = mc^2","inline":true}</m-katex-equation>'
    );
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getEquation()).toBe('E = mc^2');
      expect(node.getInline()).toBe(true);
    });
  });
});
