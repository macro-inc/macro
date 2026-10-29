import { render } from '@solidjs/testing-library';
import type { LexicalEditor } from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenuOperations } from '../../../shared/inlineMenu';
import { SnippetsMenu } from './SnippetsMenu';

const mocks = vi.hoisted(() => ({ readSnippets: vi.fn(() => []) }));

vi.mock('../MentionsMenu/hooks/useEntityMention', () => ({
  useEntityMention: () => ({ entities: mocks.readSnippets }),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@queries/storage/snippets', () => ({ fetchSnippetRaw: vi.fn() }));
vi.mock('../../../directive/floatWithSelection', () => ({
  floatWithSelection: () => {},
}));

const editor = {
  dispatchCommand: vi.fn(),
  getRootElement: () => null,
} as unknown as LexicalEditor;

afterEach(() => mocks.readSnippets.mockClear());

describe('SnippetsMenu', () => {
  // Snippets come from the app-wide Quick Access index, which a first read
  // builds over every item; every composer mounts this menu closed.
  it('reads snippets only once the menu opens', async () => {
    const menu = createMenuOperations();
    render(() => <SnippetsMenu editor={editor} menu={menu} />);
    expect(mocks.readSnippets).not.toHaveBeenCalled();

    menu.openMenu();
    await vi.waitFor(() => expect(mocks.readSnippets).toHaveBeenCalled());
  });
});
