import * as Effect from 'effect/Effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSoupBackfillCheckpoint,
  runSoupBackfills,
  type SoupBackfillParams,
} from './backfill';

const lane = (
  checkpointId: string,
  fetchPage: NonNullable<SoupBackfillParams['fetchPage']>
): SoupBackfillParams => ({
  checkpointId,
  fetchPage,
  input: {
    limit: 1,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
  },
});

describe('runSoupBackfills', () => {
  beforeEach(() => localStorage.clear());

  it('runs each lane to completion before starting the next lane', async () => {
    const order: string[] = [];
    let finishFirstLane!: () => void;
    const firstLaneFinished = new Promise<void>((resolve) => {
      finishFirstLane = resolve;
    });
    const firstFetch = vi.fn(async () => {
      order.push('first:start');
      await firstLaneFinished;
      order.push('first:end');
      return { nextCursor: null };
    });
    const secondFetch = vi.fn(async () => {
      order.push('second');
      return { nextCursor: null };
    });

    const running = Effect.runPromise(
      runSoupBackfills('user-1', [
        lane('first-lane', firstFetch),
        lane('second-lane', secondFetch),
      ])
    );

    await vi.waitFor(() => expect(firstFetch).toHaveBeenCalledOnce());
    expect(secondFetch).not.toHaveBeenCalled();

    finishFirstLane();
    await running;

    expect(order).toEqual(['first:start', 'first:end', 'second']);
    expect(loadSoupBackfillCheckpoint('user-1', 'first-lane').completed).toBe(
      true
    );
    expect(loadSoupBackfillCheckpoint('user-1', 'second-lane').completed).toBe(
      true
    );
  });
});
