import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coordinatorLivenessLockName,
  newCoordinatorLockName,
} from '../worker/coordinator-protocol';
import { COORDINATOR_RECONNECT_TIMEOUT_MS } from '../worker/startup';
import {
  CoordinatorGenerations,
  NewerCoordinatorRunsError,
} from './coordinator-generations';
import { originLocks } from './worker-host.integration-helpers';

const BUILD = { scope: 'scope', buildTime: 1 };
const TURN = newCoordinatorLockName(BUILD);

let running: number[];
/** Generations whose lock a page was given, to learn that they ended. */
let watched: number[];
let locks: ReturnType<typeof originLocks>;

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000 });
  running = [];
  watched = [];
  locks = originLocks();
  vi.stubGlobal('navigator', {
    locks: {
      request: locks.request,
      query: async () => ({
        held: [
          ...running.map((generation) => ({
            name: coordinatorLivenessLockName({ ...BUILD, generation }, 'id'),
            mode: 'exclusive',
          })),
          ...watched.map((generation) => ({
            name: coordinatorLivenessLockName({ ...BUILD, generation }, 'id'),
            mode: 'shared',
          })),
          // Another build's, another scope's, and no coordinator's.
          { name: 'graphql-cache-coordinator:scope:2:9999999:id' },
          { name: 'graphql-cache-coordinator:other:1:9999999:id' },
          { name: 'graphql-cache-tab:scope:9999999' },
          { name: TURN },
        ],
      }),
    },
  });
});

afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const newPage = () => new CoordinatorGenerations('scope', 1);

/** A page that connected to what it picked, and was not answered. */
async function unansweredPage() {
  const page = newPage();
  await page.pick();
  page.endAttempt();
  return page;
}

describe('CoordinatorGenerations', () => {
  it('connects to the newest that runs, or the last it knew', async () => {
    const page = newPage();
    expect(await page.pick()).toBe(0);
    running = [0, 7, 3];
    expect(await page.pick()).toBe(7);
    running = [3];
    expect(await page.pick()).toBe(3);
    running = [];
    expect(await page.pick()).toBe(3);
  });

  it('leaves an attempt alone that began before its list of locks came', async () => {
    const page = newPage();
    const { query } = navigator.locks;
    const asked = Promise.withResolvers<void>();
    navigator.locks.query = async () => {
      const held = await query();
      await asked.promise;
      return held;
    };
    running = [3];
    const late = page.pick();
    page.endAttempt();
    navigator.locks.query = query;
    running = [3, 7];
    expect(await page.pick()).toBe(7);

    asked.resolve();
    await late;
    running = [];
    expect(await page.pick()).toBe(7);
  });

  it('starts a generation when none answered and none runs', async () => {
    const page = await unansweredPage();
    expect(await page.renameUnanswered(false)).toBe(true);
    expect(await page.pick()).toBe(1_000);
    page.endAttempt();

    expect(await page.renameUnanswered(false)).toBe(true);
    expect(await page.pick()).toBe(1_001);
    page.endAttempt();
  });

  it('gives one that runs every attempt but the last', async () => {
    running = [0];
    const page = await unansweredPage();
    expect(await page.renameUnanswered(false)).toBe(false);
    expect(await page.pick()).toBe(0);
    page.endAttempt();

    expect(await page.renameUnanswered(true)).toBe(true);
    expect(await page.pick()).toBe(1_000);
    page.endAttempt();
  });

  it('goes to a newer one that runs, instead of starting another', async () => {
    const page = await unansweredPage();
    running = [5];
    expect(await page.renameUnanswered(true)).toBe(false);
    expect(await page.pick()).toBe(5);
  });

  it('lets one page start a generation, which the others join', async () => {
    const first = await unansweredPage();
    const second = await unansweredPage();
    expect(await first.renameUnanswered(false)).toBe(true);
    const waiting = second.renameUnanswered(false);
    running = [await first.pick()];
    first.endAttempt();

    expect(await waiting).toBe(false);
    expect(await second.pick()).toBe(1_000);
    second.endAttempt();
    // The turn is free again.
    const third = await unansweredPage();
    running = [];
    expect(await third.renameUnanswered(false)).toBe(true);
    third.endAttempt();
  });

  it('starts one all the same when the page before it never ends its turn', async () => {
    const frozen = await unansweredPage();
    expect(await frozen.renameUnanswered(false)).toBe(true);
    const page = await unansweredPage();
    const renamed = page.renameUnanswered(false);
    await vi.advanceTimersByTimeAsync(COORDINATOR_RECONNECT_TIMEOUT_MS);
    expect(await renamed).toBe(true);
    page.endAttempt();
    frozen.endAttempt();
  });

  it('gives up its turn when the attempt ends while it waits', async () => {
    const first = await unansweredPage();
    await first.renameUnanswered(false);
    const page = await unansweredPage();
    const renamed = page.renameUnanswered(false);
    await vi.advanceTimersByTimeAsync(0);
    page.endAttempt();
    expect(await renamed).toBe(false);
    expect(await page.pick()).toBe(0);
    page.endAttempt();
    first.endAttempt();

    const next = await unansweredPage();
    expect(await next.renameUnanswered(false)).toBe(true);
    next.endAttempt();
  });

  it('notices that a newer one runs, and stops looking with the attempt', async () => {
    running = [0];
    const page = newPage();
    await page.pick();
    const attempt = new AbortController();
    const outcome = page
      .untilNewerRuns(attempt.signal)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3_000);
    running = [0, 5];
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toBeInstanceOf(NewerCoordinatorRunsError);

    const ended = expect(page.untilNewerRuns(attempt.signal)).rejects.toThrow();
    attempt.abort();
    await ended;
  });

  it('keeps its name where the browser lists no locks', async () => {
    vi.stubGlobal('navigator', { locks: { request: locks.request } });
    const page = await unansweredPage();
    expect(await page.renameUnanswered(true)).toBe(false);
    expect(await page.pick()).toBe(0);
    page.endAttempt();
  });

  it('keeps its name where the browser never lists its locks', async () => {
    vi.stubGlobal('navigator', {
      locks: {
        request: locks.request,
        query: () => new Promise<LockManagerSnapshot>(() => {}),
      },
    });
    const page = newPage();
    const picked = page.pick();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await picked).toBe(0);
    page.endAttempt();
    const renamed = page.renameUnanswered(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await renamed).toBe(false);
  });

  it('takes no turn for an attempt that ended while it looked', async () => {
    const page = await unansweredPage();
    const renamed = page.renameUnanswered(false);
    page.endAttempt();
    expect(await renamed).toBe(false);

    const next = await unansweredPage();
    expect(await next.renameUnanswered(false)).toBe(true);
    next.endAttempt();
  });

  it('does not take a page that was told the holder is gone for a coordinator', async () => {
    watched = [7];
    const page = newPage();
    expect(await page.pick()).toBe(0);
    page.endAttempt();
  });
});
