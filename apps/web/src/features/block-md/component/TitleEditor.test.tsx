import { CLOSE_EMOJI_SEARCH_COMMAND } from '@core/component/LexicalMarkdown/plugins/emojis/emojisPlugin';
import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { $createInlineSearchNode } from '@macro-inc/lexical-core';
import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
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
// The real mutation's ordering: renames made with the same scope run one at a
// time, in the order they were made (covered for the real one in rename.test).
vi.mock('@entity', async () => {
  const { useMutation } = await import('@tanstack/solid-query');
  return {
    createRenameDssEntityMutation: (_callbacks: unknown, scope?: string) =>
      useMutation(() => ({
        scope: scope === undefined ? undefined : { id: scope },
        mutationFn: (variables: unknown) => rename(variables),
      })),
  };
});
vi.mock('@property/tags', () => ({ useDocTags: () => ({}) }));
vi.mock('@core/component/LexicalMarkdown/component/menu/EmojiMenu', () => ({
  EmojiMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/TagsMenu', () => ({
  TagsMenu: () => null,
}));

const LOADED_SOURCE: MarkdownDocumentSource = {
  type: 'sync',
  source: createNoopLiveSyncSource('document-1'),
};

let queryClient = new QueryClient();

beforeEach(() => {
  rename.mockReset();
  rename.mockImplementation(() => Promise.resolve({ success: true }));
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
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
    for (const connect of observers.splice(0)) connect();
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  queryClient.clear();
});

let connectObservers = () => {};

/** Holds each rename in flight until the test settles it. */
function holdRenames() {
  const settle: Array<(result: RenameResult | Error) => void> = [];
  rename.mockImplementation(
    () =>
      new Promise<RenameResult>((resolve, reject) => {
        settle.push((result) =>
          result instanceof Error ? reject(result) : resolve(result)
        );
      })
  );
  return settle;
}

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
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
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

it('saves a title edited just before the document closes', async () => {
  const title = renderTitle('Old title');
  title.type('New title');
  title.unmount();

  await vi.waitFor(() =>
    expect(rename).toHaveBeenCalledWith({
      entity: { type: 'document', id: 'document-1', name: 'Old title' },
      newName: 'New title',
    })
  );
});

it('saves renames in the order typed across a close and reopen', async () => {
  vi.useFakeTimers();
  const renames = holdRenames();
  const closed = renderTitle('');
  closed.type('Weekly');
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).toHaveBeenCalledTimes(1);

  // Closing the document saves the rest at once, while the first rename is
  // still in flight; sent together, the server could apply them out of order.
  closed.type('Weekly sync');
  closed.unmount();
  // The document opens again and its title is edited before either settles.
  const reopened = renderTitle('Weekly sync');
  reopened.type('Weekly sync agenda');
  reopened.blur();
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).toHaveBeenCalledTimes(1);

  renames[0]({ success: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(rename).toHaveBeenCalledTimes(2);
  renames[1]({ success: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(rename.mock.calls.map(([variables]) => variables)).toEqual([
    {
      entity: { type: 'document', id: 'document-1', name: '' },
      newName: 'Weekly',
    },
    {
      entity: { type: 'document', id: 'document-1', name: 'Weekly' },
      newName: 'Weekly sync',
    },
    {
      entity: { type: 'document', id: 'document-1', name: 'Weekly sync' },
      newName: 'Weekly sync agenda',
    },
  ]);
});

it('saves a title changed back to its saved name while a rename is in flight', async () => {
  vi.useFakeTimers();
  const renames = holdRenames();
  const title = renderTitle('Roadmap');
  title.type('Weekly');
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).toHaveBeenCalledTimes(1);

  // The preview still says Roadmap, but the document ends as Weekly unless
  // Roadmap is saved again.
  title.type('Roadmap');
  title.blur();
  await vi.advanceTimersByTimeAsync(400);
  renames[0]({ success: true });
  await vi.advanceTimersByTimeAsync(0);

  expect(title.text()).toBe('Roadmap');
  expect(rename).toHaveBeenLastCalledWith({
    entity: { type: 'document', id: 'document-1', name: 'Weekly' },
    newName: 'Roadmap',
  });
});

it('saves text left in an emoji search when its menu closes', async () => {
  vi.useFakeTimers();
  const title = renderTitle('');
  // Typing ":" starts an emoji search, which opens the menu.
  title.editor.update(
    () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createInlineSearchNode(':')));
    },
    { discrete: true }
  );
  title.editor.update(
    () => {
      const search = $getRoot().getFirstDescendant();
      if ($isTextNode(search)) search.setTextContent(':draft');
    },
    { discrete: true }
  );
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).not.toHaveBeenCalled();

  // Clicking away closes the menu and leaves the same text, unsearched.
  title.editor.dispatchCommand(CLOSE_EMOJI_SEARCH_COMMAND, undefined);
  await vi.advanceTimersByTimeAsync(400);

  expect(title.text()).toBe(':draft');
  expect(rename).toHaveBeenLastCalledWith({
    entity: { type: 'document', id: 'document-1', name: '' },
    newName: ':draft',
  });
});

it('saves text left in an open emoji search when the document closes', async () => {
  const title = renderTitle('');
  title.editor.update(
    () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createInlineSearchNode(':')));
    },
    { discrete: true }
  );
  title.editor.update(
    () => {
      const search = $getRoot().getFirstDescendant();
      if ($isTextNode(search)) search.setTextContent(':draft');
    },
    { discrete: true }
  );
  title.unmount();

  await vi.waitFor(() =>
    expect(rename).toHaveBeenCalledWith({
      entity: { type: 'document', id: 'document-1', name: '' },
      newName: ':draft',
    })
  );
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

it('shows a rename made elsewhere once its own rename settles', async () => {
  vi.useFakeTimers();
  const renames = holdRenames();
  const title = renderTitle('Roadmap');
  title.type('Roadmap 2027');
  title.blur();
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).toHaveBeenCalledTimes(1);

  // Someone else renames the document while this rename is in flight.
  title.publish('Q3 roadmap');
  await vi.advanceTimersByTimeAsync(0);
  expect(title.text()).toBe('Roadmap 2027');

  renames[0]({ success: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(title.text()).toBe('Q3 roadmap');
  // Showing it saves nothing.
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).toHaveBeenCalledTimes(1);
});

it('keeps the title when a late copy of an earlier name arrives during its rename', async () => {
  vi.useFakeTimers();
  const renames = holdRenames();
  const title = renderTitle('');
  title.type('Weekly');
  await vi.advanceTimersByTimeAsync(400);
  title.type('Weekly sync');
  title.blur();
  await vi.advanceTimersByTimeAsync(400);

  // A preview read from before either rename lands while they are in flight.
  title.publish('');
  await vi.advanceTimersByTimeAsync(0);
  title.publish('Weekly');
  await vi.advanceTimersByTimeAsync(0);
  renames[0]({ success: true });
  await vi.advanceTimersByTimeAsync(0);
  renames[1]({ success: true });
  await vi.advanceTimersByTimeAsync(0);

  expect(title.text()).toBe('Weekly sync');
  expect(rename).toHaveBeenLastCalledWith({
    entity: { type: 'document', id: 'document-1', name: 'Weekly' },
    newName: 'Weekly sync',
  });
});

it('keeps the title while its rename is in flight, and after it fails', async () => {
  vi.useFakeTimers();
  const renames = holdRenames();
  const title = renderTitle('Roadmap');
  title.type('Roadmap 2027');
  title.blur();
  await vi.advanceTimersByTimeAsync(400);
  expect(rename).toHaveBeenCalledTimes(1);

  // The preview republishes the name the rename replaces, and then a rename
  // made elsewhere.
  title.publish('Roadmap');
  await vi.advanceTimersByTimeAsync(0);
  title.publish('Q3 roadmap');
  await vi.advanceTimersByTimeAsync(0);
  expect(title.text()).toBe('Roadmap 2027');

  // The mutation reports the failure; the text stays, with its undo history,
  // to try again.
  renames[0](new Error('refused'));
  await vi.advanceTimersByTimeAsync(0);
  expect(title.text()).toBe('Roadmap 2027');
});

it('keeps the title when its rename is refused without an error', async () => {
  vi.useFakeTimers();
  const renames = holdRenames();
  const title = renderTitle('Roadmap');
  title.type('Roadmap 2027');
  title.blur();
  await vi.advanceTimersByTimeAsync(400);
  title.publish('Q3 roadmap');
  await vi.advanceTimersByTimeAsync(0);

  renames[0]({ success: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(title.text()).toBe('Roadmap 2027');
});
