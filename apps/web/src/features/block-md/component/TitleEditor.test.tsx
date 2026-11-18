import { render } from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from 'lexical';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownDocumentProvider } from '../context/markdown-document-context';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import type { MarkdownDocumentSource } from '../types';
import { MarkdownNameProvider } from './MarkdownNameProvider';
import { TitleEditor } from './TitleEditor';

type RenameResult = { success: boolean };

const rename = vi.hoisted(() =>
  vi.fn(
    (_variables: unknown): Promise<RenameResult> =>
      Promise.resolve({ success: true })
  )
);
vi.mock('@entity', () => ({
  createRenameDssEntityMutation: () => ({
    mutate: rename,
    mutateAsync: rename,
  }),
}));
vi.mock('@property/tags', () => ({ useDocTags: () => ({}) }));
vi.mock('@core/component/LexicalMarkdown/component/menu/EmojiMenu', () => ({
  EmojiMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/TagsMenu', () => ({
  TagsMenu: () => null,
}));

const LOADED_SOURCE = {
  type: 'sync',
  source: {},
} as unknown as MarkdownDocumentSource;

beforeEach(() => {
  rename.mockReset();
  rename.mockImplementation(() => Promise.resolve({ success: true }));
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
  connectObservers = () => {
    for (const connect of observers) connect();
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let connectObservers = () => {};

/**
 * Mounts a loaded document's title. `publish` stands in for the document's
 * preview, which republishes its name whenever anything in its batch
 * changes, including when the name itself did not.
 */
function renderTitle(initialName: string) {
  const [savedName, setSavedName] = createSignal(initialName, {
    equals: false,
  });
  const state = createMarkdownDocumentState();
  const view = render(() => (
    <MarkdownDocumentProvider
      context={{
        documentId: () => 'document-1',
        kind: () => 'document',
        documentSource: () => LOADED_SOURCE,
        permissions: {
          canComment: () => true,
          canEdit: () => true,
          isOwner: () => true,
        },
        persistedName: savedName,
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
  connectObservers();
  const editor = state.editor.md.titleEditor as LexicalEditor;
  const root = editor.getRootElement() as HTMLElement;
  return {
    ...view,
    editor,
    publish: setSavedName,
    blur: () => root.dispatchEvent(new FocusEvent('blur')),
    type: (text: string) =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append($createParagraphNode().append($createTextNode(text)));
        },
        { discrete: true }
      ),
    text: () => editor.getEditorState().read(() => $getRoot().getTextContent()),
  };
}

it('saves a title edited just before the document closes', () => {
  const title = renderTitle('Old title');
  title.type('New title');
  title.unmount();

  expect(rename).toHaveBeenCalledWith({
    entity: { type: 'document', id: 'document-1', name: 'Old title' },
    newName: 'New title',
  });
});

it('keeps the characters typed after an earlier save when Enter leaves the title', async () => {
  vi.useFakeTimers();
  const title = renderTitle('');

  // A pause long enough for the debounce saves the first word.
  title.type('Weekly');
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).toHaveBeenLastCalledWith({
    entity: { type: 'document', id: 'document-1', name: '' },
    newName: 'Weekly',
  });
  // The rename's optimistic write reaches the preview.
  title.publish('Weekly');
  await vi.advanceTimersByTimeAsync(0);

  // The rest is typed quickly, then Enter moves into the body.
  for (const text of ['Weekly ', 'Weekly s', 'Weekly sy', 'Weekly syn']) {
    title.type(text);
    await vi.advanceTimersByTimeAsync(60);
  }
  title.type('Weekly sync');
  title.blur();
  await vi.advanceTimersByTimeAsync(0);

  // The first save settles and the preview republishes its unchanged name.
  title.publish('Weekly');
  await vi.advanceTimersByTimeAsync(0);
  title.publish('Weekly');
  await vi.advanceTimersByTimeAsync(400);

  expect(title.text()).toBe('Weekly sync');
  expect(rename).toHaveBeenLastCalledWith({
    entity: { type: 'document', id: 'document-1', name: 'Weekly' },
    newName: 'Weekly sync',
  });
});

it('keeps unsaved characters when a click away is followed by a republish', async () => {
  vi.useFakeTimers();
  const title = renderTitle('Roadmap');
  title.type('Roadmap 2027');
  title.blur();
  await vi.advanceTimersByTimeAsync(0);
  title.publish('Roadmap');
  await vi.advanceTimersByTimeAsync(0);
  title.publish('Roadmap');
  await vi.advanceTimersByTimeAsync(400);

  expect(title.text()).toBe('Roadmap 2027');
  expect(rename).toHaveBeenLastCalledWith({
    entity: { type: 'document', id: 'document-1', name: 'Roadmap' },
    newName: 'Roadmap 2027',
  });
});

it('keeps characters still waiting to save when the earlier save arrives late', async () => {
  vi.useFakeTimers();
  const title = renderTitle('');
  title.type('Weekly');
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).toHaveBeenCalledTimes(1);

  // Without the normalized cache, the preview learns of the first save only
  // when its refetch lands, after more has been typed.
  title.type('Weekly sync');
  title.blur();
  await vi.advanceTimersByTimeAsync(0);
  title.publish('Weekly');
  await vi.advanceTimersByTimeAsync(400);

  expect(title.text()).toBe('Weekly sync');
  expect(rename).toHaveBeenLastCalledWith({
    entity: { type: 'document', id: 'document-1', name: '' },
    newName: 'Weekly sync',
  });
});

it('shows a rename made elsewhere when the title has no unsaved edits', async () => {
  vi.useFakeTimers();
  const title = renderTitle('Roadmap');
  await vi.advanceTimersByTimeAsync(0);

  title.publish('Roadmap 2027');
  await vi.advanceTimersByTimeAsync(0);
  expect(title.text()).toBe('Roadmap 2027');

  title.publish('Q3 roadmap');
  await vi.advanceTimersByTimeAsync(0);
  expect(title.text()).toBe('Q3 roadmap');
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).not.toHaveBeenCalled();
});

it('keeps the title while its rename is in flight, and shows the saved name if it fails', async () => {
  vi.useFakeTimers();
  let fail = (_error: Error) => {};
  rename.mockImplementation(
    () =>
      new Promise<RenameResult>((_resolve, reject) => {
        fail = reject;
      })
  );
  const title = renderTitle('Roadmap');
  title.type('Roadmap 2027');
  title.blur();
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).toHaveBeenCalledTimes(1);

  title.publish('Q3 roadmap');
  await vi.advanceTimersByTimeAsync(0);
  expect(title.text()).toBe('Roadmap 2027');

  fail(new Error('refused'));
  await vi.advanceTimersByTimeAsync(0);
  expect(title.text()).toBe('Q3 roadmap');
});
