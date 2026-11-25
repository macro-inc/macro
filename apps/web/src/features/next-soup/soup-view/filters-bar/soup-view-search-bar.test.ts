import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: () => null,
}));

import { searchTextOf } from './soup-view-search-bar';

describe('searchTextOf', () => {
  it('reads the field as typed, without markdown escapes', () => {
    expect(searchTextOf('status:in\\_progress tag:\\*starred\\*')).toBe(
      'status:in_progress tag:*starred*'
    );
    expect(searchTextOf('C:\\\\temp')).toBe('C:\\temp');
  });
});
