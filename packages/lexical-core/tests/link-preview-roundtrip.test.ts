import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { ALL_TRANSFORMERS } from '../transformers';

/**
 * `preview: false` on an m-link ("remove link preview") must survive an
 * editor round-trip — it rides the LinkNode's `rel` attribute, since the
 * stock node has no slot for extra payload fields.
 */
async function roundTrip(markdown: string): Promise<string> {
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

  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}

describe('m-link preview flag round-trip', () => {
  it('preserves preview: false through import and export', async () => {
    const input =
      '<m-link>{"url":"https://example.com","text":"Example","title":"","preview":false}</m-link>';
    const output = await roundTrip(input);
    expect(output).toContain('"preview":false');
    expect(output).toContain('"url":"https://example.com"');
  });

  it('does not invent a preview field for ordinary links', async () => {
    const input =
      '<m-link>{"url":"https://example.com","text":"Example","title":""}</m-link>';
    const output = await roundTrip(input);
    expect(output).not.toContain('preview');
  });
});
