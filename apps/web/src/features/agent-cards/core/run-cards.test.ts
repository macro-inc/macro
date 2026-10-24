import { describe, expect, it } from 'vitest';
import {
  itemFacts,
  itemKey,
  replacesStep,
  runCards,
  stepItem,
} from './run-cards';

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

describe('what the agent showed in a run', () => {
  it('comes in the order the steps showed it, without what they did to items', () => {
    const view = { kind: 'view', view: { widgets: [] } };
    const cards = runCards([
      { id: 'a', card: document('doc-1', 'created', 'Plan') },
      { id: 'b' },
      { id: 'c', card: view },
      { id: 'd', card: { kind: 'data', sql: 'SELECT 1', display: 'table' } },
    ]);
    expect(cards.map((card) => card.kind)).toEqual(['view', 'data']);
    expect(cards[1]).toMatchObject({ rowId: 'd', sql: 'SELECT 1' });
  });

  it('leaves out a card this version cannot read', () => {
    expect(
      runCards([
        { id: 'a', card: { kind: 'hologram' } },
        { id: 'b', card: null },
        { id: 'c', card: { kind: 'sources', total: 1, sources: [] } },
      ])
    ).toEqual([]);
  });

  it('carries drafts saved for review, once per review, under the step that presented them', () => {
    const review = {
      kind: 'review',
      reviewId: '0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6',
      drafts: 'email',
    };
    expect(runCards([{ id: 'review_1', card: review }])).toEqual([
      {
        kind: 'review',
        key: 'review:0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6',
        rowId: 'review_1',
        reviewId: '0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6',
        drafts: 'email',
      },
    ]);
  });

  it('tells a card shown in place of its step from one shown under it', () => {
    expect(replacesStep({ kind: 'view', view: {} })).toBe(true);
    expect(
      replacesStep({ kind: 'review', reviewId: 'r', drafts: 'calendar' })
    ).toBe(true);
    expect(replacesStep({ kind: 'data', sql: 'SELECT 1' })).toBe(false);
    expect(replacesStep(document('doc-1', 'created'))).toBe(false);
    expect(replacesStep(undefined)).toBe(false);
  });
});

describe('what a reply did to the items it touched', () => {
  it('names the item a step created on its row', () => {
    expect(stepItem(document('doc-1', 'created', 'Plan'))).toEqual({
      item: { type: 'document', id: 'doc-1', fileType: 'md' },
      action: 'created',
      title: 'Plan',
      summary: null,
    });
    expect(stepItem({ kind: 'view', view: {} })).toBeUndefined();
  });

  it('says the most done to an item touched twice', () => {
    const facts = itemFacts([
      { card: document('doc-1', 'edited') },
      { card: document('doc-1', 'created', 'Plan') },
      { card: document('doc-1', 'edited') },
    ]);
    expect(facts.size).toBe(1);
    expect(facts.get(itemKey({ type: 'document', id: 'doc-1' }))).toMatchObject(
      { action: 'created', title: 'Plan' }
    );
  });

  it('keeps a summary only while it says what was done to the item', () => {
    const twice = itemFacts([
      { card: document('doc-1', 'edited', 'Plan', '12 cells') },
      { card: document('doc-1', 'edited', 'Plan', '3 changes') },
    ]);
    const stronger = itemFacts([
      { card: document('doc-2', 'edited', 'Plan', '12 cells') },
      { card: document('doc-2', 'renamed', 'Plan v2') },
    ]);
    expect(twice.get('document:doc-1')).toMatchObject({
      action: 'edited',
      summary: null,
    });
    expect(stronger.get('document:doc-2')).toMatchObject({
      action: 'renamed',
      summary: null,
    });
  });
});
