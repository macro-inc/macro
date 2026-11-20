import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const openPreview = vi.hoisted(() => vi.fn());
const [previews, setPreviews] = createSignal<
  Record<string, Record<string, unknown>>
>({});

vi.mock('@core/component/ItemPreview', () => ({
  useItemPreviewData: (entity: () => { id: string }) => ({
    item: () => previews()[entity().id] ?? { loading: true },
    name: () => previews()[entity().id]?.name,
    targetType: () => 'database',
    onPreviewClick: openPreview,
  }),
}));

vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => (
    <i data-icon={props.targetType} />
  ),
}));

const documentRow = {
  type: 'document' as const,
  id: 'doc-1',
  name: 'Doc',
  ownerId: 'owner',
  notifications: [{ id: 'n1', state: 'unseen' }],
};
/** What soup returns for the list; `undefined` while it has not answered. */
const [soupRows, setSoupRows] = createSignal<
  (typeof documentRow)[] | undefined
>([documentRow]);

vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({
    notificationsByEntity: () => ({}),
  }),
}));

vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => ({
    get data() {
      const entities = soupRows();
      return entities ? { entities } : undefined;
    },
  }),
}));

vi.mock('@app/features/next-soup/filters/filter-store', () => ({
  compileToAst: () => ({}),
  defineQueryFilters: (query: unknown) => query,
  queryStateFrom: (query: unknown) => query,
}));

vi.mock('@app/features/next-soup/filters/query-filters', () => ({
  soupItemMatchesQuery: () => true,
}));

vi.mock('@app/features/next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: vi.fn(),
}));

vi.mock('@entity', () => ({
  ListEntityMetadataQueryProvider: (props: { children: unknown }) =>
    props.children,
}));

vi.mock('@entity/composed/ListEntity', () => ({
  ListEntity: (props: { entity: { notifications?: unknown } }) => (
    <div
      data-testid="list-row"
      data-notifications={typeof props.entity.notifications}
    />
  ),
  ListLayoutProvider: (props: { children: unknown }) => props.children,
}));

vi.mock('@app/features/agent-cards/components/collection', () => ({
  CollectionCard: (props: {
    children?: JSX.Element;
    title: string;
    count: number;
  }) => (
    <section data-testid="collection" data-count={props.count}>
      <h3>{props.title}</h3>
      {props.children}
    </section>
  ),
  CollectionGroup: (props: { children?: JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));

import { List } from './List';

afterEach(() => {
  cleanup();
  setPreviews({});
  setSoupRows([documentRow]);
  openPreview.mockClear();
});

describe('list widget soup notifications', () => {
  it('wraps raw GraphQL notification arrays as accessors before ListEntity', () => {
    render(() => (
      <List
        source={{
          kind: 'items',
          entities: [{ id: 'doc-1', type: 'document' }],
        }}
      />
    ));
    expect(
      screen.getByTestId('list-row').getAttribute('data-notifications')
    ).toBe('function');
  });
});

const database = {
  loading: false,
  access: 'access',
  id: 'db-1',
  type: 'database',
  name: 'Cow-ender',
  rawName: 'Cow-ender',
};

const shownCount = () =>
  screen.getByTestId('collection').getAttribute('data-count');
const rows = () => document.querySelectorAll('[data-card-row]');

describe('an items list', () => {
  it('shows a database the soup query cannot return, by id, and opens it', async () => {
    setSoupRows([]);
    setPreviews({ 'db-1': database });
    render(() => (
      <List
        source={{ kind: 'items', entities: [{ id: 'db-1', type: 'database' }] }}
      />
    ));
    expect(shownCount()).toBe('1');
    await fireEvent.click(screen.getByRole('button', { name: /Cow-ender/ }));
    expect(openPreview).toHaveBeenCalledWith(
      'database',
      'db-1',
      undefined,
      undefined,
      false
    );
  });

  it('keeps soup rows and adds the refs soup did not return', () => {
    setPreviews({ 'db-1': database });
    render(() => (
      <List
        source={{
          kind: 'items',
          entities: [
            { id: 'doc-1', type: 'document' },
            { id: 'db-1', type: 'database' },
          ],
        }}
      />
    ));
    expect(screen.getAllByTestId('list-row')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Cow-ender/ })).toBeTruthy();
    expect(shownCount()).toBe('2');
  });

  it('adds no rows by id until soup has answered', () => {
    setSoupRows(undefined);
    setPreviews({ 'db-1': database });
    render(() => (
      <List
        source={{ kind: 'items', entities: [{ id: 'db-1', type: 'database' }] }}
      />
    ));
    expect(rows()).toHaveLength(0);
    setSoupRows([]);
    expect(rows()).toHaveLength(1);
  });

  it('never shows the name of an item the viewer cannot open', () => {
    setSoupRows([]);
    setPreviews({
      'db-1': {
        loading: false,
        access: 'no_access',
        id: 'db-1',
        name: 'Secret plans',
      },
      'db-2': {
        loading: false,
        access: 'does_not_exist',
        id: 'db-2',
        name: 'Old plans',
      },
    });
    render(() => (
      <List
        source={{
          kind: 'items',
          entities: [
            { id: 'db-1', type: 'database' },
            { id: 'db-2', type: 'database' },
          ],
        }}
      />
    ));
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText(/Secret plans|Old plans/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps a kind no card loads as an unavailable row instead of dropping it', () => {
    setSoupRows([]);
    render(() => (
      <List
        source={{
          kind: 'items',
          entities: [{ id: 'contact-1', type: 'crm_contact' }],
        }}
      />
    ));
    expect(shownCount()).toBe('1');
    expect(rows()).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws nothing for an items list with no refs', () => {
    render(() => <List source={{ kind: 'items', entities: [] }} />);
    expect(screen.queryByTestId('collection')).toBeNull();
  });
});
