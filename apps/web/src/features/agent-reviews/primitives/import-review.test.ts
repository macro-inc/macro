/** @vitest-environment jsdom */
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { ImportPlanEntry } from '../core/import-plan';
import type { Review, ReviewDecision } from '../core/review';
import { createImportReview } from './import-review';

it.each([
  { phase: 'before the debounce saves', inFlight: false },
  { phase: 'while the exclusion save is in flight', inFlight: true },
])('approves restored selections $phase', async ({ inFlight }) => {
  vi.useFakeTimers();
  const initial: Extract<Review, { kind: 'import' }> = {
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
  const entries: ImportPlanEntry[] = [
    {
      id: 'page',
      parentId: null,
      kind: 'page',
      title: 'Notes',
      decision: 'copy',
      reason: null,
      rows: null,
      sampleTitles: [],
      taskFields: null,
      status: 'staged',
      error: null,
      shared: false,
      sharedReason: null,
      shareable: false,
      alreadyImported: null,
    },
    {
      id: 'database',
      parentId: 'page',
      kind: 'database',
      title: 'Work',
      decision: 'copy',
      reason: null,
      rows: 8,
      sampleTitles: [],
      taskFields: null,
      status: 'staged',
      error: null,
      shared: false,
      sharedReason: null,
      shareable: false,
      alreadyImported: null,
    },
  ];
  let saved = structuredClone(initial);
  let submitted: (typeof saved.items)[0]['draft'] | undefined;
  let firstSave = true;
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const actions = {
    reload: async (): Promise<Review> => structuredClone(saved),
    decide: vi.fn(async (decision: ReviewDecision): Promise<Review> => {
      if (decision.action === 'edit' && firstSave) {
        firstSave = false;
        started.resolve();
        if (inFlight) await release.promise;
      }
      if (decision.revision !== saved.revision) throw new Error('conflict');
      if (decision.action === 'edit' && decision.draft.kind === 'import') {
        saved = {
          ...saved,
          revision: saved.revision + 1,
          items: [
            {
              ...saved.items[0],
              draft: decision.draft.draft,
            },
          ],
        };
      } else if (decision.action === 'submit') {
        submitted = structuredClone(saved.items[0].draft);
        saved = {
          ...saved,
          revision: saved.revision + 1,
          items: [
            {
              ...saved.items[0],
              status: 'submitting',
            },
          ],
        };
      }
      return structuredClone(saved);
    }),
  };
  let dispose = () => {};
  const review = createRoot((cleanup) => {
    dispose = cleanup;
    return createImportReview({
      review: () => initial,
      actions,
      entries: () => entries,
      report: () => undefined,
      canAct: () => true,
      stop: async () => true,
    });
  });
  try {
    review.setIncluded('page', false);
    review.setIncluded('database', false);
    expect(review.count()).toBe(0);
    if (inFlight) {
      vi.advanceTimersByTime(300);
      await started.promise;
    }
    review.setIncluded('page', true);
    review.setIncluded('database', true);
    expect(review.count()).toBe(2);
    const approving = review.approve();
    release.resolve();
    expect(await approving).toBe(true);
    expect(submitted?.excluded).toEqual([]);
    expect(actions.decide).toHaveBeenLastCalledWith({
      action: 'submit',
      revision: inFlight ? 3 : 2,
      items: [],
    });
  } finally {
    dispose();
    vi.useRealTimers();
  }
});
