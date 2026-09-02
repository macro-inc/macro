import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityDepsProvider } from '../deps';
import { createdEvent, messagedEvent } from '../queries/fixtures';
import { createFakeActivityDeps } from '../testing/fake-deps';
import { feedPage, overviewPage } from '../testing/wire';
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

afterEach(cleanup);

function renderView() {
  const deps = createFakeActivityDeps();
  const result = render(() => (
    <ActivityDepsProvider deps={deps}>
      <MyActivityView />
    </ActivityDepsProvider>
  ));
  return { ...result, deps, graphql: deps.graphqlFake };
}

const rows = () => document.querySelectorAll('[data-activity-row]');

describe('MyActivityView', () => {
  it('shows loading copy for both the overview and the feed', () => {
    const { container } = renderView();
    expect(container.textContent).toContain('Loading activity overview…');
    expect(container.textContent).toContain('Loading…');
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

  it('opens the row entity through the injected opener', () => {
    const { deps, graphql } = renderView();
    graphql.latest('MyActivity').resolve(feedPage([createdEvent]));

    const body = rows()[0]?.querySelector('.hover\\:bg-hover\\/30');
    if (!body) throw new Error('row body not rendered');
    fireEvent.click(body);

    expect(deps.opened).toEqual([
      { block: 'md', id: 'doc-1', params: undefined, newSplit: false },
    ]);
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

  it('lists the most active entities and opens them', () => {
    const { container, deps, graphql } = renderView();
    graphql.latest('MyActivityOverview').resolve(
      overviewPage({
        total: 4,
        topEntities: [{ entityType: 'DOCUMENT', entityId: 'doc-7', count: 4 }],
      })
    );

    expect(container.textContent).toContain('Most active');
    expect(container.textContent).toContain('4 actions');

    const section = screen.getByLabelText('Most active');
    const body = section.querySelector('.hover\\:bg-hover\\/30');
    if (!body) throw new Error('top entity body not rendered');
    fireEvent.click(body);

    expect(deps.opened).toEqual([
      { block: 'md', id: 'doc-7', params: undefined, newSplit: false },
    ]);
  });
});
