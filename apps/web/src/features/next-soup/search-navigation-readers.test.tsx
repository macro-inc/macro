import { createAgentRouteTarget } from '@app/features/block-agent/primitives/create-agent-route-target';
import { createMarkdownRouteNavigation } from '@app/features/block-md/primitives/create-markdown-route-navigation';
import { createPdfRouteTarget } from '@app/features/block-pdf/primitives/create-pdf-route-target';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  defineRoute,
  replacePaneSearchParams,
  type SplitPanePolicy,
  SplitRouter,
} from '@app/split-router';
import type { SearchLocation } from '@entity';
import { cleanup, render } from '@solidjs/testing-library';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  searchLocationTarget,
  searchLocationUpdates,
} from './search-navigation';

afterEach(cleanup);

const policy: SplitPanePolicy = {
  placeNewPane: ({ panes }) => ({ insertAt: panes.length }),
  closeAction: () => ({ type: 'keep' }),
  activate: () => {},
};

function setup(location: SearchLocation) {
  const target = searchLocationTarget('document', location);
  const query = new URLSearchParams();
  replacePaneSearchParams(query, [{ [target.namespace]: target.params }]);
  const route = defineRoute({
    id: 'detail',
    path: 'detail',
    search: '*' as const,
  });
  const navigateMarkdown = vi.fn();
  let router!: ReturnType<typeof createSplitRouter>;
  let pdf!: ReturnType<typeof createPdfRouteTarget>;
  let agent!: ReturnType<typeof createAgentRouteTarget>;
  let setDocument!: (id: string) => void;
  let documentId!: Accessor<string>;
  function Reader() {
    [documentId, setDocument] = createSignal('document');
    createMarkdownRouteNavigation(documentId, navigateMarkdown);
    pdf = createPdfRouteTarget(documentId);
    agent = createAgentRouteTarget();
    return null;
  }
  render(() => {
    router = createSplitRouter({
      routes: {
        definitions: [route],
        defaultRoute: () => ({ matches: [{ id: 'detail', params: {} }] }),
      },
      history: createMemoryHistory(`/detail?${query}`),
      paneStore: createMemoryPaneStore(),
      policy,
    });
    onCleanup(() => router.dispose());
    return (
      <SplitRouter.Root router={router}>
        <SplitRouter.Scope pane={router.panes()[0]!}>
          <Reader />
        </SplitRouter.Scope>
      </SplitRouter.Root>
    );
  });
  return {
    navigateMarkdown,
    pdf,
    agent,
    setDocument,
    router,
    replay: () =>
      router.navigatePane(
        router.panes()[0]!,
        { route },
        {
          search: searchLocationUpdates('document', location),
        }
      ),
  };
}

it('delivers cold and repeated Markdown targets, but never to another document in the pane', async () => {
  const test = setup({ type: 'md', nodeId: 'node' });
  expect(test.navigateMarkdown).toHaveBeenCalledExactlyOnceWith({
    node_id: 'node',
  });
  test.replay();
  await test.router.settled();
  expect(test.navigateMarkdown).toHaveBeenCalledTimes(2);
  test.setDocument('other-document');
  expect(test.navigateMarkdown).toHaveBeenCalledTimes(2);
});

it('delivers complete PDF highlight requests and replays the same page', async () => {
  const test = setup({
    type: 'pdf',
    searchPage: 7,
    searchRawQuery: 'one two',
    searchSnippet: 'one & two',
    highlightTerms: ['one', 'two'],
  });
  const first = test.pdf();
  expect(first).toEqual({
    pdf_search_page: '7',
    pdf_search_raw_query: 'one two',
    pdf_search_snippet: 'one & two',
    pdf_search_highlight_terms: '["one","two"]',
  });
  test.replay();
  await test.router.settled();
  expect(test.pdf()).toEqual(first);
  expect(test.pdf()).not.toBe(first);
  test.setDocument('other-document');
  expect(test.pdf()).toBeUndefined();
});

it('keeps agent turn zero and creates a fresh scroll request for a repeated hit', async () => {
  const test = setup({ type: 'agent', messageTurn: 0, author: 'agent' });
  const first = test.agent();
  expect(first).toEqual({ messageTurn: 0, author: 'agent' });
  test.replay();
  await test.router.settled();
  expect(test.agent()).toEqual(first);
  expect(test.agent()).not.toBe(first);
});
