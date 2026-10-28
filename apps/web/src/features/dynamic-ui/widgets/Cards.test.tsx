import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@app/features/agent-cards/components/item-card', () => ({
  ItemCard: (props: { item: { type: string; id: string } }) => (
    <p>{[props.item.type, props.item.id].join(' ')}</p>
  ),
}));

import { Cards } from './Cards';

afterEach(cleanup);

it('shows one card per item, in order', () => {
  const view = render(() => (
    <Cards
      items={[
        { type: 'document', id: 'doc-1' },
        { type: 'routine', id: 'routine-1' },
      ]}
    />
  ));
  expect(
    view.getAllByRole('paragraph').map((card) => card.textContent)
  ).toEqual(['document doc-1', 'routine routine-1']);
});

it('leaves items past six to a list', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    type: 'document' as const,
    id: `doc-${index}`,
  }));
  const view = render(() => <Cards title="Docs" items={items} />);
  expect(view.getAllByRole('paragraph')).toHaveLength(6);
  expect(view.getByRole('region', { name: 'Docs' })).toBeTruthy();
});
