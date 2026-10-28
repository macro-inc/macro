import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ItemListSource } from '../context/crm-sources';
import { RecordItemList } from './record-item-list';

const mounted = vi.hoisted(() => vi.fn());

vi.mock('@app/features/next-soup/soup-view/date-group-heading', () => ({
  DateGroupHeading: (props: { label: string }) => (
    <header>{props.label}</header>
  ),
}));
vi.mock('@entity', () => ({
  ListEntity: (props: {
    entity: { name: string };
    referencePropertyIds?: readonly string[];
  }) => {
    mounted(props.referencePropertyIds);
    return <div>{props.entity.name}</div>;
  },
  ListEntityMetadataQueryProvider: (props: ParentProps) => props.children,
  ListLayoutProvider: (props: ParentProps) => props.children,
}));
vi.mock('@ui', () => ({
  cn: (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' '),
  EmptyStatePanel: (props: {
    title?: string;
    description?: string;
    primaryAction?: { label: string; onClick: () => void };
  }) => (
    <div>
      <h2>{props.title}</h2>
      <p>{props.description}</p>
      {props.primaryAction && (
        <button type="button" onClick={props.primaryAction.onClick}>
          {props.primaryAction.label}
        </button>
      )}
    </div>
  ),
  Button: (props: ParentProps<{ onClick: () => void }>) => (
    <button type="button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));
vi.mock('../../../lib/primitives/infinite-scroll-sentinel', () => ({
  useInfiniteScrollSentinel: vi.fn(),
}));
vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    createNavigation: () => ({ openEntity: vi.fn() }),
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function source(overrides: Partial<ItemListSource>): ItemListSource {
  return {
    isPending: false,
    isEnabled: true,
    isLoading: false,
    data: {
      entities: [{ id: 'doc-1', name: 'Kickoff notes' }] as never,
    },
    hasNextPage: false,
    isFetchingNextPage: false,
    isError: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(async () => undefined),
    refetch: vi.fn(async () => undefined),
    ...overrides,
  };
}

it('replaces cached rows and retries the query after a failed refetch', () => {
  const failed = source({ isError: true });
  render(() => <RecordItemList source={failed} empty="Nothing" />);

  expect(screen.queryByText('Kickoff notes')).toBeNull();
  screen.getByText("Couldn't load this list.");
  fireEvent.click(screen.getByText('Try again'));
  expect(failed.refetch).toHaveBeenCalledTimes(1);
  expect(failed.fetchNextPage).not.toHaveBeenCalled();
});

it('keeps loaded rows and retries the page after a failed continuation', () => {
  const failed = source({ isFetchNextPageError: true, hasNextPage: true });
  render(() => <RecordItemList source={failed} empty="Nothing" />);

  screen.getByText('Kickoff notes');
  screen.getByText("Couldn't load more.");
  fireEvent.click(screen.getByText('Retry'));
  expect(failed.fetchNextPage).toHaveBeenCalledTimes(1);
  expect(failed.refetch).not.toHaveBeenCalled();
});

it('searches titles and supporting text without dropping pagination', () => {
  const list = source({
    data: {
      entities: [
        { id: 'call-1', name: 'Pilot check-in', summary: 'Review adoption' },
        {
          id: 'call-2',
          name: 'Technical deep dive',
          summary: 'Security review',
        },
      ] as never,
    },
    hasNextPage: true,
  });
  render(() => (
    <RecordItemList source={list} search="  REVIEW pilot  " empty="Nothing" />
  ));

  screen.getByText('Pilot check-in');
  expect(screen.queryByText('Technical deep dive')).toBeNull();
  expect(screen.queryByText('No matching items.')).toBeNull();
});

it('only declares no search results after the final page', () => {
  render(() => (
    <RecordItemList
      source={source({ hasNextPage: true })}
      search="missing"
      empty="Nothing"
    />
  ));
  screen.getByRole('status', { name: 'Searching more items' });
  expect(screen.queryByText('No matching items.')).toBeNull();
});

it('clears a finished search without hiding loaded rows', () => {
  const clear = vi.fn();
  render(() => (
    <RecordItemList
      source={source({ hasNextPage: false })}
      search="missing"
      onClearSearch={clear}
    />
  ));
  fireEvent.click(screen.getByText('Clear search'));
  expect(clear).toHaveBeenCalledTimes(1);
});

it('keeps an empty first page pageable until more results arrive', () => {
  render(() => (
    <RecordItemList
      source={source({ data: { entities: [] }, hasNextPage: true })}
      search="missing"
      empty="Nothing"
    />
  ));
  screen.getByRole('status', { name: 'Searching more items' });
  expect(screen.queryByText('Nothing')).toBeNull();
});
it('keeps the paging marker mounted when a local filter removes an entire page', () => {
  const view = render(() => (
    <RecordItemList
      source={source({ data: { entities: [] }, hasNextPage: true })}
      empty="Nothing"
    />
  ));
  screen.getByRole('status', { name: 'Searching more items' });
  expect(screen.queryByText('Nothing')).toBeNull();
  expect(view.container.querySelector('.h-px')).not.toBeNull();
});

it('continues date groups across pages without remounting earlier rows', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 27, 12));
  mounted.mockClear();
  const [entities, setEntities] = createSignal([
    {
      id: 'doc-1',
      type: 'document',
      name: 'First page',
      updatedAt: new Date(2026, 9, 27, 10),
    },
  ]);
  const list = source({ hasNextPage: true });
  Object.defineProperty(list, 'data', {
    get: () => ({ entities: entities() }),
  });
  const view = render(() => (
    <RecordItemList
      source={list}
      empty="Nothing"
      groupByDate
      referencePropertyIds={['reference-id']}
    />
  ));
  const first = screen.getByText('First page');
  expect(screen.getAllByText('Today')).toHaveLength(1);
  setEntities([
    {
      id: 'doc-1',
      type: 'document',
      name: 'First page updated',
      updatedAt: new Date(2026, 9, 27, 10),
    },
    {
      id: 'doc-2',
      type: 'document',
      name: 'Same date, next page',
      updatedAt: new Date(2026, 9, 27, 9),
    },
    {
      id: 'doc-3',
      type: 'document',
      name: 'Older page',
      updatedAt: new Date(2026, 9, 26, 9),
    },
  ]);
  expect(screen.getByText('First page updated')).toBe(first);
  screen.getByText('Same date, next page');
  screen.getByText('Older page');
  expect(screen.getAllByText('Today')).toHaveLength(1);
  expect(screen.getAllByText('Yesterday')).toHaveLength(1);
  expect(mounted).toHaveBeenCalledTimes(3);
  expect(mounted).toHaveBeenCalledWith(['reference-id']);
  view.unmount();
});
