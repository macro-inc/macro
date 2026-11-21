/** @vitest-environment jsdom */
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { ImportPlanEntry, ImportProgress } from '../core/import-plan';
import type { Review } from '../core/review';
import { createImportReview } from './import-review';

it('keeps a newly discovered external dependency excluded while refreshing its saved draft', async () => {
  const record: Review = {
    id: 'review',
    sessionId: 'session',
    actingUser: 'macro|owner@example.com',
    executionId: null,
    presentedAt: 1,
    decision: null,
    title: 'Import',
    revision: 1,
    updatedAt: 1,
    kind: 'import',
    items: [
      {
        id: 'selection',
        status: 'pending',
        error: null,
        result: null,
        draft: { source: 'notion', excluded: [], shared: [], personal: [] },
      },
    ],
  };
  const report: ImportProgress = {
    reviewId: 'review',
    status: 'ready',
    error: null,
    scanned: null,
    onTeam: false,
    counts: {
      pages: 1,
      databases: 1,
      copy: 2,
      tasks: 0,
      skip: 0,
      hand: 0,
      deciding: 0,
    },
    imported: 0,
    waiting: 0,
    writing: 0,
    failures: [],
  };
  const [entries, setEntries] = createSignal<ImportPlanEntry[]>([]);
  const actions = {
    reload: vi.fn(async () => record),
    decide: vi.fn(async () => record),
  };
  let dispose = () => {};
  const review = createRoot((cleanup) => {
    dispose = cleanup;
    return createImportReview({
      review: () => record,
      actions,
      entries,
      report: () => report,
      canAct: () => true,
      stop: async () => true,
    });
  });
  try {
    setEntries([
      {
        id: 'linked',
        parentId: null,
        kind: 'database',
        title: 'Linked work',
        linkedFrom: ['Page'],
        decision: 'copy',
        reason: null,
        rows: 0,
        sampleTitles: [],
        taskFields: null,
        status: 'staged',
        error: null,
        shared: false,
        sharedReason: null,
        shareable: false,
        alreadyImported: null,
      },
    ]);
    expect(review.isExcluded('linked')).toBe(true);
  } finally {
    dispose();
  }
});
