import { describe, expect, it } from 'vitest';
import { isViewCard, runCards } from './cards';

const document = (itemId: string, action: string, title?: string) => ({
  kind: 'item',
  itemType: 'document',
  itemId,
  fileType: 'md',
  action,
  title: title ?? null,
});

describe('the cards a run produced', () => {
  it('come in the order the steps produced them', () => {
    const view = { kind: 'view', view: { widgets: [] } };
    const cards = runCards([
      { id: 'a', card: document('doc-1', 'created', 'Plan') },
      { id: 'b' },
      { id: 'c', card: view },
    ]);
    expect(cards.map((card) => card.kind)).toEqual(['item', 'view']);
    expect(cards[0]).toMatchObject({
      item: { type: 'document', id: 'doc-1', fileType: 'md' },
      action: 'created',
      title: 'Plan',
    });
  });

  it('show an item touched twice once, saying the most it did', () => {
    const cards = runCards([
      { id: 'a', card: document('doc-1', 'edited') },
      { id: 'b', card: document('doc-1', 'created', 'Plan') },
      { id: 'c', card: document('doc-1', 'edited') },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ action: 'created', title: 'Plan' });
  });

  it('leave out a card this version cannot read', () => {
    expect(
      runCards([
        { id: 'a', card: { kind: 'hologram' } },
        { id: 'b', card: null },
      ])
    ).toEqual([]);
  });

  it('tell a composed view from an item', () => {
    expect(isViewCard({ kind: 'view', view: {} })).toBe(true);
    expect(isViewCard(document('doc-1', 'created'))).toBe(false);
    expect(isViewCard(undefined)).toBe(false);
  });
});
