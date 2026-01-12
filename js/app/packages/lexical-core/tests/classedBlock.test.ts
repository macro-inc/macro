import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $createClassedBlockNode,
  $isClassedBlockNode,
} from '../nodes/ClassedBlockNode';
import { INTERNAL_TRANSFORMERS } from '../transformers';

describe('ClassedBlockNode - macro_quote transformer', () => {
  it('serializes and deserializes a simple macro_quote block', async () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: console.error,
    });

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          const macroQuote = $createClassedBlockNode({
            tag: 'div',
            classes: ['macro_quote', 'gmail_quote'],
          });

          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode('This is a quoted email'));
          macroQuote.append(paragraph);

          root.append(macroQuote);
        },
        { onUpdate: () => resolve() }
      );
    });

    let markdown = '';
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(INTERNAL_TRANSFORMERS);
    });

    // Verify the markdown contains the email-thread-embed tag and metadata
    expect(markdown).toContain('<m-email-thread-embed>');
    expect(markdown).toContain('</m-email-thread-embed>');
    expect(markdown).toContain('"tag":"div"');
    expect(markdown).toContain('"classes":["macro_quote","gmail_quote"]');
    expect(markdown).toContain('This is a quoted email');

    // Now convert back to editor state
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

    // Verify the node structure is preserved
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const firstChild = root.getFirstChild();

      expect($isClassedBlockNode(firstChild)).toBe(true);
      if ($isClassedBlockNode(firstChild)) {
        expect(firstChild.__tag).toBe('div');
        expect(firstChild.__classes).toEqual(['macro_quote', 'gmail_quote']);

        const paragraph = firstChild.getFirstChild();
        expect(paragraph?.getType()).toBe('paragraph');
        expect(paragraph?.getTextContent()).toBe('This is a quoted email');
      }
    });
  });

  it('handles macro_quote with nested content', async () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: console.error,
    });

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          const macroQuote = $createClassedBlockNode({
            tag: 'div',
            classes: ['macro_quote', 'gmail_quote'],
          });

          const p1 = $createParagraphNode();
          p1.append($createTextNode('First paragraph'));

          const p2 = $createParagraphNode();
          p2.append($createTextNode('Second paragraph'));

          macroQuote.append(p1, p2);
          root.append(macroQuote);
        },
        { onUpdate: () => resolve() }
      );
    });

    let markdown = '';
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(INTERNAL_TRANSFORMERS);
    });

    // Convert back
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

    // Verify nested content is preserved
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const firstChild = root.getFirstChild();

      expect($isClassedBlockNode(firstChild)).toBe(true);
      if ($isClassedBlockNode(firstChild)) {
        const children = firstChild.getChildren();
        expect(children.length).toBeGreaterThanOrEqual(2);
        expect(children[0].getTextContent()).toContain('First paragraph');
        expect(children[1].getTextContent()).toContain('Second paragraph');
      }
    });
  });

  it('does not serialize ClassedBlockNode without macro_quote class', async () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: console.error,
    });

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          const classedBlock = $createClassedBlockNode({
            tag: 'div',
            classes: ['some_other_class'],
          });

          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode('Not a macro quote'));
          classedBlock.append(paragraph);

          root.append(classedBlock);
        },
        { onUpdate: () => resolve() }
      );
    });

    let markdown = '';
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(INTERNAL_TRANSFORMERS);
    });

    // Should not contain macro-quote tags
    expect(markdown).not.toContain('<macro-quote>');
    expect(markdown).toContain('Not a macro quote');
  });

  it('preserves line breaks in macro_quote content', async () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: console.error,
    });

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot();
          const macroQuote = $createClassedBlockNode({
            tag: 'div',
            classes: ['macro_quote'],
          });

          const p1 = $createParagraphNode();
          p1.append($createTextNode('Line 1'));

          const p2 = $createParagraphNode();
          p2.append($createTextNode('Line 2'));

          const p3 = $createParagraphNode();
          p3.append($createTextNode('Line 3'));

          macroQuote.append(p1, p2, p3);
          root.append(macroQuote);
        },
        { onUpdate: () => resolve() }
      );
    });

    let markdown = '';
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(INTERNAL_TRANSFORMERS);
    });

    // Convert back
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

    // Verify structure is preserved
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const firstChild = root.getFirstChild();

      expect($isClassedBlockNode(firstChild)).toBe(true);
      if ($isClassedBlockNode(firstChild)) {
        const text = firstChild.getTextContent();
        expect(text).toContain('Line 1');
        expect(text).toContain('Line 2');
        expect(text).toContain('Line 3');
      }
    });
  });
});
