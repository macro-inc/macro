import { render } from '@solidjs/testing-library';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownDocumentProvider } from '../context/markdown-document-context';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import { MarkdownNameProvider } from './MarkdownNameProvider';
import { TitleEditor } from './TitleEditor';

const rename = vi.hoisted(() => vi.fn());
vi.mock('@entity', () => ({
  createRenameDssEntityMutation: () => ({ mutate: rename }),
}));
vi.mock('@property/tags', () => ({ useDocTags: () => ({}) }));
vi.mock('@core/component/LexicalMarkdown/component/menu/EmojiMenu', () => ({
  EmojiMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/TagsMenu', () => ({
  TagsMenu: () => null,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

it('saves a title edited just before the document closes', () => {
  // The title connects from a ResizeObserver callback, as in the browser.
  const observers: Array<() => void> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  const state = createMarkdownDocumentState();
  const { unmount } = render(() => (
    <MarkdownDocumentProvider
      context={{
        documentId: () => 'document-1',
        kind: () => 'document',
        documentSource: () => ({ type: 'loading' }),
        permissions: {
          canComment: () => true,
          canEdit: () => true,
          isOwner: () => true,
        },
        persistedName: () => 'Old title',
        fallbackName: () => 'New Document',
        state,
        element: () => undefined,
      }}
    >
      <MarkdownNameProvider>
        <TitleEditor />
      </MarkdownNameProvider>
    </MarkdownDocumentProvider>
  ));
  for (const connect of observers) connect();

  state.editor.md.titleEditor?.update(
    () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('New title')));
    },
    { discrete: true }
  );
  unmount();

  expect(rename).toHaveBeenCalledWith({
    entity: { type: 'document', id: 'document-1', name: 'Old title' },
    newName: 'New title',
  });
});
