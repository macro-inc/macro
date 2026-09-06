import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityContextProvider } from '../context/activity-context';
import { placeholderOverview } from '../core/placeholder-overview';
import { createdEvent, messagedEvent } from '../queries/fixtures';
import { createMockActivityContext } from '../tests/mock-context';
import { feedPage, overviewPage } from '../tests/wire';
import { MyActivityView } from './my-activity-view';

vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: unknown }) => props.children,
}));

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: { children: unknown }) => props.children,
    StaticMarkdown: () => null,
  })
);

// Module-load quarantine, not a dependency substitute: the connection-gateway
// websocket connects when imported, which jsdom cannot do.
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));

vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob: () => Promise.reject(new Error('no websocket in tests')),
}));

afterEach(cleanup);

function renderView() {
  const context = createMockActivityContext();
  const onOpen = vi.fn();
  const result = render(() => (
    <ActivityContextProvider value={context}>
      <MyActivityView onOpen={onOpen} />
    </ActivityContextProvider>
  ));
  return { ...result, onOpen, graphql: context.graphqlMock };
}

const rows = () => document.querySelectorAll('[data-activity-row]');

describe('MyActivityView', () => {
  it('shows a same-shape graph skeleton and loading copy for the feed', () => {
    const { container, graphql } = renderView();
    const skeleton = container.querySelector('[data-activity-graph-skeleton]');
    if (!skeleton) throw new Error('graph skeleton not rendered');
    const skeletonDays = skeleton.querySelectorAll(
      '[data-activity-day]'
    ).length;
    expect(skeletonDays).toBeGreaterThan(300);
    expect(container.textContent).not.toContain('Loading activity overview');
    expect(container.textContent).toContain('Loading…');

    const placeholder = placeholderOverview(new Date());
    graphql
      .latest('MyActivityOverview')
      .resolve(overviewPage({ from: placeholder.from, to: placeholder.to }));

    expect(
      container.querySelector('[data-activity-graph-skeleton]')
    ).toBeNull();
    expect(container.querySelectorAll('[data-activity-day]').length).toBe(
      skeletonDays
    );
  });

  it('shows unavailable copy when the overview fails', () => {
    const { container, graphql } = renderView();
    graphql.latest('MyActivityOverview').fail('boom');
    expect(
      container.querySelector('[data-activity-graph-skeleton]')
    ).toBeNull();
    expect(container.textContent).toContain(
      'Activity overview is unavailable right now.'
    );
  });

  it('renders grouped rows with actor names and pages on Show more', async () => {
    const { graphql } = renderView();
    graphql
      .latest('MyActivity')
      .resolve(feedPage([createdEvent, messagedEvent], 'cursor-2'));

    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.getAttribute('data-activity-action')).toBe('created');
    expect(rows()[1]?.getAttribute('data-activity-action')).toBe('messaged');
    expect(screen.getAllByText('sarah')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    const next = graphql.latest('MyActivity');
    expect(next.variables).toEqual({
      input: { limit: 50, cursor: 'cursor-2' },
    });

    next.resolve(feedPage([{ ...createdEvent, id: 'evt-99' }], null));
    expect(rows()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('asks the host to open the row entity', () => {
    const { onOpen, graphql } = renderView();
    graphql.latest('MyActivity').resolve(feedPage([createdEvent]));

    const body = rows()[0]?.querySelector('.hover\\:bg-hover\\/30');
    if (!body) throw new Error('row body not rendered');
    fireEvent.click(body);

    expect(onOpen).toHaveBeenCalledExactlyOnceWith({
      block: 'md',
      id: 'doc-1',
      params: undefined,
      newSplit: false,
    });
  });

  it('shows unavailable copy when the feed fails', () => {
    const { container, graphql } = renderView();
    graphql.latest('MyActivity').fail('boom');
    expect(container.textContent).toContain(
      'Activity is unavailable right now.'
    );
  });

  it('shows empty copy when the feed has no rows', () => {
    const { container, graphql } = renderView();
    graphql.latest('MyActivity').resolve(feedPage([]));
    expect(container.textContent).toContain('No activity yet.');
  });

  it('renders the most active entities as chips under the graph and opens them', () => {
    const { container, onOpen, graphql } = renderView();
    graphql.latest('MyActivityOverview').resolve(
      overviewPage({
        total: 7,
        topEntities: [
          { entityType: 'DOCUMENT', entityId: 'doc-7', count: 4 },
          { entityType: 'DOCUMENT', entityId: 'doc-8', count: 3 },
        ],
      })
    );

    const section = screen.getByLabelText('Most active');
    const chips = section.querySelectorAll('[data-activity-top-entity]');
    expect(chips).toHaveLength(2);
    expect(chips[0]?.textContent).toContain('4');
    expect(section.textContent).not.toContain('actions');

    const graph = container.querySelector(
      '[aria-labelledby="activity-actions-heading"]'
    );
    expect(graph?.closest('[data-layer]')?.parentElement).toBe(
      section.parentElement
    );

    const chip = chips[0];
    if (!chip) throw new Error('top entity chip not rendered');
    fireEvent.click(chip);

    expect(onOpen).toHaveBeenCalledExactlyOnceWith({
      block: 'md',
      id: 'doc-7',
      params: undefined,
      newSplit: false,
    });
  });

  it('renders no most-active row when the overview has no top entities', () => {
    const { container, graphql } = renderView();
    graphql.latest('MyActivityOverview').resolve(overviewPage({ total: 0 }));
    expect(screen.queryByLabelText('Most active')).toBeNull();
    expect(container.textContent).not.toContain('No entities yet.');
  });
});
