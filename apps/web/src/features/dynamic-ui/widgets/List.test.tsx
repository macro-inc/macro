import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  entities: [
    {
      type: 'document' as const,
      id: 'doc-1',
      name: 'Doc',
      ownerId: 'owner',
      notifications: [{ id: 'n1', state: 'unseen' }],
    },
  ],
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

vi.mock('@entity/components/CollapsibleList', () => ({
  CollapsibleList: (props: {
    items: unknown[];
    children: (item: unknown) => JSX.Element;
  }) => <div>{props.children(props.items[0])}</div>,
}));

import { List } from './List';

afterEach(cleanup);

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
