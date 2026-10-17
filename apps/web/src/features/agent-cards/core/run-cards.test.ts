import { describe, expect, it } from 'vitest';
import { replacesStep, runCards } from './run-cards';

const document = (
  itemId: string,
  action: string,
  title?: string,
  summary?: string
) => ({
  kind: 'item',
  itemType: 'document',
  itemId,
  fileType: 'md',
  action,
  title: title ?? null,
  summary: summary ?? null,
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

  it('keep a summary only while it says what was done to the item', () => {
    const [twice, stronger] = [
      runCards([
        { id: 'a', card: document('doc-1', 'edited', 'Plan', '12 cells') },
        { id: 'b', card: document('doc-1', 'edited', 'Plan', '3 changes') },
      ]),
      runCards([
        { id: 'a', card: document('doc-2', 'edited', 'Plan', '12 cells') },
        { id: 'b', card: document('doc-2', 'renamed', 'Plan v2') },
      ]),
    ];
    expect(twice[0]).toMatchObject({ action: 'edited', summary: null });
    expect(stronger[0]).toMatchObject({ action: 'renamed', summary: null });
  });

  it('gather what every search found into one list, each thing once', () => {
    const web = (url: string) => ({ kind: 'web', url, title: url });
    const cards = runCards([
      {
        id: 'a',
        card: {
          kind: 'sources',
          query: 'lumen pricing',
          sources: [web('https://a.example'), web('https://b.example')],
          total: 9,
        },
      },
      { id: 'b', card: document('doc-1', 'created', 'Plan') },
      {
        id: 'c',
        card: {
          kind: 'sources',
          query: 'lumen pricing',
          sources: [
            web('https://b.example'),
            { kind: 'item', itemType: 'document', itemId: 'doc-9' },
          ],
          total: 2,
        },
      },
      {
        id: 'd',
        card: { kind: 'data', sql: 'SELECT 1', display: 'table' },
      },
    ]);
    expect(cards.map((card) => card.kind)).toEqual(['sources', 'item', 'data']);
    expect(cards[0]).toMatchObject({
      rowId: 'a',
      queries: ['lumen pricing'],
      total: 10,
    });
    expect(
      cards[0].kind === 'sources' ? cards[0].sources.length : undefined
    ).toBe(3);
    expect(cards[2]).toMatchObject({ rowId: 'd', sql: 'SELECT 1' });
  });

  it('leave out a card this version cannot read', () => {
    expect(
      runCards([
        { id: 'a', card: { kind: 'hologram' } },
        { id: 'b', card: null },
      ])
    ).toEqual([]);
  });

  it('carry drafts saved for review, once per review, under the step that presented them', () => {
    const review = {
      kind: 'review',
      reviewId: '0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6',
      drafts: 'email',
    };
    expect(
      runCards([
        { id: 'review_1', card: review },
        { id: 'b', card: document('doc-1', 'created') },
      ])
    ).toEqual([
      {
        kind: 'review',
        key: 'review:0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6',
        rowId: 'review_1',
        reviewId: '0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6',
        drafts: 'email',
      },
      expect.objectContaining({ kind: 'item', rowId: 'b' }),
    ]);
  });

  it('tell a card shown in place of its step from a receipt', () => {
    expect(replacesStep({ kind: 'view', view: {} })).toBe(true);
    expect(
      replacesStep({ kind: 'review', reviewId: 'r', drafts: 'calendar' })
    ).toBe(true);
    expect(replacesStep(document('doc-1', 'created'))).toBe(false);
    expect(replacesStep(undefined)).toBe(false);
  });
});
