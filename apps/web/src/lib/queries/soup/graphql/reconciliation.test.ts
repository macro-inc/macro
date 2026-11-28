import type { GraphqlSoupItem } from '@service-storage/graphql-soup';
import { describe, expect, it } from 'vitest';
import {
  materializeReconciledSoup,
  soupItemKey,
  soupReconciliationBaseline,
  unreconciledServerRecords,
} from './reconciliation';

const item = (id: string, typename = 'GraphqlSoupDocument') =>
  ({
    __typename: typename,
    id,
    documentName: id,
    createdAt: '2026-01-01T00:00:00.123456Z',
    updatedAt: '2026-02-01T00:00:00.654321Z',
  }) as GraphqlSoupItem;

describe('flat Soup baseline reconciliation', () => {
  it('uses normalized identities across entity kinds and preserves timestamp precision', () => {
    const document = item('same');
    const project = item('same', 'GraphqlSoupProject');
    const chat = item('same', 'GraphqlSoupChat');
    expect(
      soupReconciliationBaseline(
        [document, project, chat, document],
        'UPDATED_AT'
      )
    ).toEqual(
      [document, project, chat].map((record) => ({
        key: soupItemKey(record),
        sortTimestamp: '2026-02-01T00:00:00.654321Z',
      }))
    );
    expect(
      soupReconciliationBaseline([document], 'CREATED_AT')?.[0].sortTimestamp
    ).toBe('2026-01-01T00:00:00.123456Z');
  });

  it('uses the start of an active call and the end of an archived call for update order', () => {
    const active = {
      __typename: 'GraphqlSoupCall',
      id: 'active-call',
      startedAt: '2026-01-01T00:00:00.123456Z',
      endedAt: null,
    };
    const archived = {
      ...active,
      id: 'archived-call',
      endedAt: '2026-02-01T00:00:00.654321Z',
    };
    const partial = {
      __typename: 'GraphqlSoupCall',
      id: 'partial-call',
      startedAt: active.startedAt,
    };

    expect(
      soupReconciliationBaseline([active, archived], 'UPDATED_AT')
    ).toEqual([
      { key: 'GraphqlSoupCall:active-call', sortTimestamp: active.startedAt },
      { key: 'GraphqlSoupCall:archived-call', sortTimestamp: archived.endedAt },
    ]);
    expect(soupReconciliationBaseline([archived], 'CREATED_AT')).toEqual([
      {
        key: 'GraphqlSoupCall:archived-call',
        sortTimestamp: archived.startedAt,
      },
    ]);
    expect(soupReconciliationBaseline([partial], 'UPDATED_AT')).toBeUndefined();
  });

  it('refuses missing sort evidence and oversized baselines rather than dropping server rows', () => {
    expect(
      soupReconciliationBaseline(
        [{ ...item('a'), updatedAt: undefined } as unknown as GraphqlSoupItem],
        'UPDATED_AT'
      )
    ).toBeUndefined();
    expect(
      soupReconciliationBaseline(
        Array.from({ length: 5001 }, (_, i) => item(String(i))),
        'UPDATED_AT'
      )
    ).toBeUndefined();
  });

  it('merges new server rows without duplicates or resurrecting covered removals', () => {
    const kept = item('kept');
    const removed = item('removed');
    const candidate = item('candidate');
    const nextPage = item('next-page');
    const sameIdProject = item('candidate', 'GraphqlSoupProject');
    const baselineKeys = new Set([soupItemKey(kept), soupItemKey(removed)]);
    const displayedKeys = new Set([soupItemKey(kept), soupItemKey(candidate)]);
    expect(
      unreconciledServerRecords(
        [kept, removed, candidate, nextPage, nextPage, sameIdProject],
        baselineKeys,
        displayedKeys
      )
    ).toEqual([nextPage, sameIdProject]);
    expect(baselineKeys.size).toBe(2);
    expect(displayedKeys.size).toBe(2);
  });

  it('retains unknown baseline display data, omits unrenderable new items and never resurrects removals', () => {
    const kept = item('kept');
    const removed = item('removed');
    const newItem = item('new');
    const selected = [{ recordKey: soupItemKey(newItem), record: newItem }];
    expect(
      materializeReconciledSoup(
        [
          soupItemKey(newItem),
          soupItemKey(kept),
          'GraphqlSoupDocument:unrenderable',
          soupItemKey(kept),
        ],
        selected,
        [kept, removed]
      )
    ).toEqual([newItem, kept]);
  });
});
