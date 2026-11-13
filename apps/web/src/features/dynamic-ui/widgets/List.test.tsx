import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import {
  afterEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

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

const fixture = vi.hoisted(() => ({
  entities: [
    {
      type: 'document' as const,
      id: 'doc-1',
      name: 'Doc',
      ownerId: 'owner',
      notifications: [{ id: 'n1', state: 'unseen' }],
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({
    notificationsByEntity: () => ({}),
  }),
}));

vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => ({
    data: { entities: fixture.entities },
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

describe('an items list', () => {
  it('shows a database the soup query cannot return, by id, and opens it', async () => {
    const soupRows = fixture.entities;
    fixture.entities = [];
    onTestFinished(() => {
      fixture.entities = soupRows;
    });
    setPreviews({ 'db-1': database });
    render(() => (
      <List
        source={{ kind: 'items', entities: [{ id: 'db-1', type: 'database' }] }}
      />
    ));
    expect(screen.getByTestId('collection').getAttribute('data-count')).toBe(
      '1'
    );
    expect(screen.getByText('1 item')).toBeTruthy();
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
    expect(screen.getByText('Cow-ender')).toBeTruthy();
    expect(screen.getByText('2 items')).toBeTruthy();
  });

  it('shows an item the viewer cannot open as unavailable, without its name', () => {
    setPreviews({
      'db-1': { loading: false, access: 'no_access', id: 'db-1' },
      'db-2': { loading: false, access: 'does_not_exist', id: 'db-2' },
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
    expect(screen.getByText("Database · You don't have access")).toBeTruthy();
    expect(screen.getByText('Database · Deleted')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a kind no card loads as an unavailable row instead of dropping it', () => {
    render(() => (
      <List
        source={{
          kind: 'items',
          entities: [{ id: 'contact-1', type: 'crm_contact' }],
        }}
      />
    ));
    expect(screen.getByText('Crm contact')).toBeTruthy();
    expect(screen.getByText("Can't be shown here")).toBeTruthy();
    expect(screen.queryByText('Nothing matches.')).toBeNull();
  });

  it('draws nothing for an items list with no refs', () => {
    render(() => <List source={{ kind: 'items', entities: [] }} />);
    expect(screen.queryByTestId('collection')).toBeNull();
  });
});
