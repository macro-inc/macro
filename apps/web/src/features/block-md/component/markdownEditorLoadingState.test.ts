import { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import { describe, expect, it } from 'vitest';
import { isMarkdownEditorLoading } from './markdownEditorLoadingState';

describe('isMarkdownEditorLoading', () => {
  it('stops loading when the editor resolves to an error', () => {
    expect(isMarkdownEditorLoading(false, null)).toBe(true);
    expect(
      isMarkdownEditorLoading(
        false,
        MarkdownEditorErrors.VERSION_MISMATCH_ERROR
      )
    ).toBe(false);
  });

  it('stays hidden after the editor is ready', () => {
    expect(isMarkdownEditorLoading(true, null)).toBe(false);
  });
});
