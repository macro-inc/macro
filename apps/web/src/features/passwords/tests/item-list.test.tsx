import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { ItemList } from '../components/item-list';
import type { PasswordItem, PasswordKind } from '../core/types';

afterEach(cleanup);

function item(id: string, name: string, kind: PasswordKind): PasswordItem {
  return {
    id,
    teamId: 'team',
    name,
    kind,
    url: null,
    folderId: null,
    favorite: false,
    version: 1,
    hasTotp: false,
    shared: false,
    shareCount: 0,
    sharedWithTeam: true,
    canManage: true,
    canEdit: true,
    createdAt: '',
    updatedAt: '',
    lastUsedAt: null,
  };
}

const ITEMS = [
  item('a', 'Cloud key', 'api'),
  item('b', 'Bank', 'login'),
  item('c', 'Visa', 'card'),
  item('d', 'Mail', 'login'),
];

function mount(groupBy: 'none' | 'kind') {
  render(() => (
    <ItemList
      items={ITEMS}
      drafts={[]}
      groupBy={groupBy}
      onSelect={vi.fn()}
      onSelectDraft={vi.fn()}
      loadLogo={async () => undefined}
    />
  ));
}

it('sections the list by type in the New menu order, each with its count', () => {
  mount('kind');
  const sections = screen.getAllByRole('region');
  expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual(
    ['Login', 'Card', 'API credential']
  );
  expect(within(sections[0]).getByText('2')).toBeTruthy();
  expect(
    within(sections[0])
      .getAllByRole('button')
      .map((row) =>
        ['Bank', 'Mail'].find((name) => row.textContent?.includes(name))
      )
  ).toEqual(['Bank', 'Mail']);
  expect(within(sections[1]).getByRole('button').textContent).toContain('Visa');
  expect(within(sections[2]).getByRole('button').textContent).toContain(
    'Cloud key'
  );
});

it('keeps one flat list without type sections when ungrouped', () => {
  mount('none');
  expect(screen.queryAllByRole('region')).toEqual([]);
  expect(screen.getAllByRole('button')).toHaveLength(4);
});
