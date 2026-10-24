import type { ItemFact } from '@app/features/agent-cards/core/run-cards';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@app/features/agent-cards/components/item-card', () => ({
  ItemCard: (props: {
    item: { type: string; id: string; fileType?: string | null };
    action?: string;
    title?: string | null;
  }) => (
    <p>
      {[
        props.item.id,
        props.item.fileType ?? '-',
        props.action ?? '-',
        props.title ?? '-',
      ].join(' ')}
    </p>
  ),
}));

import { ItemFacts } from '@app/features/agent-cards/core/item-facts';
import { Cards } from './Cards';

afterEach(cleanup);

it('says on a card what the reply did to its item, and nothing on the rest', () => {
  const facts = new Map<string, ItemFact>([
    [
      'document:doc-1',
      {
        item: { type: 'document', id: 'doc-1', fileType: 'md' },
        action: 'created',
        title: 'Plan',
      },
    ],
  ]);
  const view = render(() => (
    <ItemFacts.Provider value={() => facts}>
      <Cards
        items={[
          { type: 'document', id: 'doc-1' },
          { type: 'routine', id: 'routine-1' },
        ]}
      />
    </ItemFacts.Provider>
  ));
  expect(
    view.getAllByRole('paragraph').map((card) => card.textContent)
  ).toEqual(['doc-1 md created Plan', 'routine-1 - - -']);
});

it('shows plain cards outside an agent reply', () => {
  const view = render(() => (
    <Cards items={[{ type: 'document', id: 'doc-1' }]} />
  ));
  expect(view.getByRole('paragraph').textContent).toBe('doc-1 - - -');
});
