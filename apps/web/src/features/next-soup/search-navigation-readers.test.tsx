import { createAgentRouteTarget } from '@app/features/block-agent/primitives/create-agent-route-target';
import { createMarkdownRouteNavigation } from '@app/features/block-md/primitives/create-markdown-route-navigation';
import { createPdfRouteTarget } from '@app/features/block-pdf/primitives/create-pdf-route-target';
import type {
  SplitRouter as Router,
  SplitRouterLayout,
  SplitRouterLayoutEntry,
} from '@app/lib/split-router';
import {
  createMemorySplitRouterLocation,
  defineRoute,
  SplitRouter,
  useSplitRouter,
} from '@app/lib/split-router';
import { replaceSplitSearchParams } from '@app/lib/split-router/search';
import type { SearchLocation } from '@entity';
import { cleanup, render } from '@solidjs/testing-library';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  searchLocationTarget,
  searchLocationUpdates,
} from './search-navigation';

afterEach(cleanup);

function setup(location: SearchLocation) {
  let entry: SplitRouterLayoutEntry<string> | undefined;
  const layout: SplitRouterLayout<string> = {
    snapshot: () => ({ entries: entry ? [entry] : [] }),
    reconcile: (locations) => {
      entry = { splitId: 'pane', location: locations[0]! };
    },
    updateCurrentLocation: (_, update) => {
      entry = { ...entry!, location: update(entry!) };
    },
    open: () => ({ status: 'unavailable' }),
    activate: () => {},
    subscribe: () => () => {},
  };
  const target = searchLocationTarget('document', location);
  const query = new URLSearchParams();
  replaceSplitSearchParams(query, [
    { location: { search: { [target.namespace]: target.params } } },
  ]);
  const route = defineRoute({
    id: 'detail',
    path: 'detail',
    search: '*' as const,
  });
  const navigateMarkdown = vi.fn();
  let router!: Router<string>;
  let pdf!: ReturnType<typeof createPdfRouteTarget>;
  let agent!: ReturnType<typeof createAgentRouteTarget>;
  let setDocument!: (id: string) => void;
  let documentId!: Accessor<string>;
  function Reader() {
    router = useSplitRouter<string>();
    [documentId, setDocument] = createSignal('document');
    createMarkdownRouteNavigation(documentId, navigateMarkdown);
    pdf = createPdfRouteTarget(documentId);
    agent = createAgentRouteTarget();
    return null;
  }
  render(() => (
    <SplitRouter.Root
      layout={layout}
      routes={{ definitions: [route] }}
      location={createMemorySplitRouterLocation(`/detail?${query}`)}
    >
      <SplitRouter.Scope splitId="pane">
        <Reader />
      </SplitRouter.Scope>
    </SplitRouter.Root>
  ));
  return {
    navigateMarkdown,
    pdf,
    agent,
    setDocument,
    router,
    replay: () =>
      router.navigate('pane', route.to(), {
        search: searchLocationUpdates('document', location),
      }),
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
