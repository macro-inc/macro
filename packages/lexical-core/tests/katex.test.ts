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

function allEquations(): EquationNode[] {
  const equations: EquationNode[] = [];
  for (const child of $getRoot().getChildren()) {
    if ($isEquationNode(child)) equations.push(child);
    if ($isParagraphNode(child)) {
      for (const paragraphChild of child.getChildren()) {
        if ($isEquationNode(paragraphChild)) equations.push(paragraphChild);
      }
    }
  }
  return equations;
}

function firstEquation(): EquationNode {
  const [first] = allEquations();
  if (!first) throw new Error('expected an equation node');
  return first;
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

  it('keeps $$...$$ display math when only whitespace surrounds it', async () => {
    const editor = await importMarkdown('  $$ E = mc^2 $$  ');
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getEquation().trim()).toBe('E = mc^2');
      expect(node.getInline()).toBe(false);
    });
  });

  it('treats $$...$$ embedded in a sentence as inline math', async () => {
    const editor = await importMarkdown(
      'The order form includes $$750{,}000$$ unit-minutes monthly.'
    );
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getEquation()).toBe('750{,}000');
      expect(node.getInline()).toBe(true);
    });
  });

  it('treats every $$...$$ on a shared line as inline math', async () => {
    const editor = await importMarkdown(
      'They charged $$\\$1{,}137.30$$, making this $$\\$1{,}125$$ too high.'
    );
    editor.getEditorState().read(() => {
      const equations = allEquations();
      expect(equations.map((node) => node.getEquation())).toEqual([
        '\\$1{,}137.30',
        '\\$1{,}125',
      ]);
      expect(equations.every((node) => node.getInline())).toBe(true);
    });
  });

  it('treats $$...$$ followed by punctuation as inline math', async () => {
    const editor = await importMarkdown('$$x = 1$$.');
    editor.getEditorState().read(() => {
      const node = firstEquation();
      expect(node.getInline()).toBe(true);
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
});
