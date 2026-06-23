import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $convertPasteToText,
  $createPasteNode,
  $isPasteNode,
} from '../nodes/PasteNode';
import { EXTERNAL_TRANSFORMERS, INTERNAL_TRANSFORMERS } from '../transformers';

function makeEditor() {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError: console.error,
  });
}

describe('PasteNode - internal transformer round-trip', () => {
  it('serializes and deserializes pasted content', async () => {
    const editor = makeEditor();
    const content = 'line one\nline two\n  indented three';

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          root.append($createPasteNode({ content }));
        },
        { onUpdate: () => resolve() }
      );
    });

    let markdown = '';
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(INTERNAL_TRANSFORMERS);
    });

    expect(markdown).toContain('<m-paste>');
    expect(markdown).toContain('</m-paste>');

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS);
        },
        { onUpdate: () => resolve() }
      );
    });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const node = root.getChildren().find($isPasteNode);
      expect(node).toBeDefined();
      expect(node?.getContent()).toBe(content);
    });
  });

  it('keeps XML-like content intact through a round-trip', async () => {
    const editor = makeEditor();
    const content = 'before <m-document-card>injected</m-document-card> after';

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          root.append($createPasteNode({ content }));
        },
        { onUpdate: () => resolve() }
      );
    });

    let markdown = '';
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(INTERNAL_TRANSFORMERS);
    });

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS);
        },
        { onUpdate: () => resolve() }
      );
    });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const node = root.getChildren().find($isPasteNode);
      expect(node?.getContent()).toBe(content);
    });
  });
});

describe('PasteNode - external transformer', () => {
  it('exports raw text to external markdown', async () => {
    const editor = makeEditor();
    const content = 'plain pasted text';

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          root.append($createPasteNode({ content }));
        },
        { onUpdate: () => resolve() }
      );
    });

    let markdown = '';
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(EXTERNAL_TRANSFORMERS);
    });

    expect(markdown).toContain(content);
    expect(markdown).not.toContain('<m-paste>');
  });
});

describe('PasteNode - convert to text', () => {
  it('converts a paste node into paragraphs of plain text', async () => {
    const editor = makeEditor();
    const content = 'first line\nsecond line';

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          root.append($createPasteNode({ content }));
        },
        { onUpdate: () => resolve() }
      );
    });

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          const node = root.getChildren().find($isPasteNode);
          if (node) $convertPasteToText(node);
        },
        { onUpdate: () => resolve() }
      );
    });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect(root.getChildren().some($isPasteNode)).toBe(false);
      expect(root.getTextContent()).toContain('first line');
      expect(root.getTextContent()).toContain('second line');
    });
  });
});
