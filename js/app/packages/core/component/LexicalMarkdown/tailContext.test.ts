/**
 * @vitest-environment jsdom
 */
import { $convertFromMarkdownString } from '@lexical/markdown';
import { ALL_TRANSFORMERS, SupportedNodeTypes } from '@lexical-core';
import { createEditor, type EditorState } from 'lexical';
import { describe, expect, it } from 'vitest';
import { tailContext } from './tailContext';

/* parse the way the message renderer does, then query the resulting state */
function parse(markdown: string): EditorState {
  const editor = createEditor({
    namespace: 'tail-context-test',
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(() => $convertFromMarkdownString(markdown, ALL_TRANSFORMERS), {
    discrete: true,
  });
  return editor.getEditorState();
}

describe('tailContext', () => {
  it('plain paragraph text is not code', () => {
    expect(tailContext(parse('hello world')).inCode).toBe(false);
  });

  it('tail inside an unclosed fence is code', () => {
    expect(tailContext(parse('intro\n```ts\nconst x = 1;')).inCode).toBe(true);
  });

  it('text after a closed fence is not code', () => {
    expect(tailContext(parse('```ts\nconst x = 1;\n```\nafter')).inCode).toBe(
      false
    );
  });

  it('tail of a closed inline code span is code', () => {
    expect(tailContext(parse('see `foo`')).inCode).toBe(true);
  });

  it('an unclosed backtick is not code (yet)', () => {
    expect(tailContext(parse('see `foo')).inCode).toBe(false);
  });

  it('empty markdown is not code', () => {
    expect(tailContext(parse('')).inCode).toBe(false);
  });
});
