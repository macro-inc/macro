import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createMarkdownDocumentState } from './markdown-document-state';

vi.mock('../queries/markdown-comments', () => ({
  fetchMarkdownComments: vi.fn(),
}));

it('keeps mutable editor state scoped to each document', () => {
  createRoot((dispose) => {
    const first = createMarkdownDocumentState('first');
    const second = createMarkdownDocumentState('second');

    first.rewrite.setRewriting(true);

    expect(first.rewrite.rewriting()).toBe(true);
    expect(second.rewrite.rewriting()).toBe(false);
    dispose();
  });
});
