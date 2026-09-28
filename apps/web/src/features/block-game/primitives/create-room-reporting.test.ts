import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameStatus } from '../core/status';
import type { RoundResult } from '../core/turn-match';
import {
  createRoundLedger,
  createRoundReporter,
  createStatusPublisher,
  type RoundLedger,
} from './create-room-reporting';

const ANN = 'macro|ann@macro.com';
const BOB = 'macro|bob@macro.com';
const CAT = 'macro|cat@macro.com';

const result = (round: number, winners: string[] = [ANN]): RoundResult => ({
  round,
  players: [ANN, BOB],
  winners,
});

let dispose: (() => void) | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.useRealTimers();
});

describe('createStatusPublisher', () => {
  it('publishes a status once it settles, and retries after a failure', async () => {
    const published: GameStatus[] = [];
    let succeed = false;
    const [status, setStatus] = createSignal<GameStatus>('waiting');
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      createStatusPublisher({
        status,
        enabled: () => true,
        leads: () => true,
        publish: async (next) => {
          published.push(next);
          return succeed;
        },
      });
    });

    setStatus('in_progress');
    setStatus('waiting');
    await vi.advanceTimersByTimeAsync(2_000);
    // Quick flips collapse into the value that held.
    expect(published).toEqual(['waiting']);

    succeed = true;
    setStatus('in_progress');
    await vi.advanceTimersByTimeAsync(2_000);
    setStatus('waiting');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(published).toEqual(['waiting', 'in_progress', 'waiting']);
  });

  it('never lets a slow earlier write land after a newer one', async () => {
    const pending: { status: GameStatus; resolve: (ok: boolean) => void }[] =
      [];
    const [status, setStatus] = createSignal<GameStatus>('waiting');
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      createStatusPublisher({
        status,
        enabled: () => true,
        leads: () => true,
        publish: (next) =>
          new Promise<boolean>((resolve) =>
            pending.push({ status: next, resolve })
          ),
      });
    });

    await vi.advanceTimersByTimeAsync(2_000);
    setStatus('in_progress');
    await vi.advanceTimersByTimeAsync(2_000);
    setStatus('finished');
    await vi.advanceTimersByTimeAsync(2_000);
    // Only the first write is in flight; later ones wait their turn.
    expect(pending.map((write) => write.status)).toEqual(['waiting']);

    pending[0].resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    // The queued write sends the latest value, skipping the stale one.
    expect(pending.map((write) => write.status)).toEqual([
      'waiting',
      'finished',
    ]);
    pending[1].resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(2);
  });

  it('lets the client that caused a change publish it first', async () => {
    const publish = vi.fn(async (_status: GameStatus) => true);
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      createStatusPublisher({
        status: () => 'finished',
        enabled: () => true,
        leads: () => false,
        publish,
      });
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(publish).not.toHaveBeenCalled();
    // Other editors follow up in case the leading client went offline.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(publish).toHaveBeenCalledWith('finished');
  });

  it('stays quiet while disabled', async () => {
    const publish = vi.fn(async () => true);
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      createStatusPublisher({
        status: () => 'finished',
        enabled: () => false,
        leads: () => true,
        publish,
      });
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(publish).not.toHaveBeenCalled();
  });
});

/** A ledger kept in memory, as when storage is unavailable. */
function memoryLedger(initial: number[] = []) {
  const rounds = new Set(initial);
  const ledger: RoundLedger = {
    has: (round) => rounds.has(round),
    add: (round) => {
      rounds.add(round);
    },
    delete: (round) => {
      rounds.delete(round);
    },
  };
  return { rounds, ledger };
}

describe('createRoundReporter', () => {
  it('vouches only for rounds its player was seen playing, even ones that ended while away', async () => {
    const reported: number[] = [];
    // Round 1 was in progress on an earlier visit; round 0 never was here.
    const { rounds, ledger } = memoryLedger([1]);
    const [results, setResults] = createSignal<RoundResult[]>([
      result(0),
      result(1),
    ]);
    const [seatedRound, setSeatedRound] = createSignal<number>();
    const [userId, setUserId] = createSignal<string | undefined>(ANN);
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      createRoundReporter({
        results,
        seatedRound,
        userId,
        enabled: () => true,
        ledger,
        report: async (round) => {
          reported.push(round.round);
          return true;
        },
      });
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(reported).toEqual([1]);
    expect(rounds.has(1)).toBe(false);

    // Round 2 is played here and finishes; it is reported once.
    setSeatedRound(2);
    setSeatedRound(undefined);
    setResults([result(0), result(1), result(2)]);
    setResults([result(0), result(1), result(2)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(reported).toEqual([1, 2]);

    // A round that shows up already finished was never seen in progress.
    setResults([result(0), result(1), result(2), result(3)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(reported).toEqual([1, 2]);

    // Only the round's players report it.
    setUserId(CAT);
    setSeatedRound(4);
    setResults([result(0), result(1), result(2), result(3), result(4)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(reported).toEqual([1, 2]);
  });

  it('retries a report that did not get through and keeps the round until one does', async () => {
    let failures = 2;
    const attempts: number[] = [];
    const { rounds, ledger } = memoryLedger([0]);
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      createRoundReporter({
        results: () => [result(0)],
        seatedRound: () => undefined,
        userId: () => ANN,
        enabled: () => true,
        ledger,
        report: async (round) => {
          attempts.push(round.round);
          if (failures === 0) return true;
          failures -= 1;
          return false;
        },
      });
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([0]);
    expect(rounds.has(0)).toBe(true);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempts).toEqual([0, 0]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempts).toEqual([0, 0, 0]);
    expect(rounds.has(0)).toBe(false);
  });
});

describe('createRoundLedger', () => {
  it('remembers rounds across visits until they are delivered', () => {
    const key = () => 'test.games.rounds.room-1.ann';
    createRoundLedger(key).add(3);
    const nextVisit = createRoundLedger(key);
    expect(nextVisit.has(3)).toBe(true);
    nextVisit.delete(3);
    expect(createRoundLedger(key).has(3)).toBe(false);
  });

  it('keeps working in memory when storage is unavailable', () => {
    const blocked = () => {
      throw new Error('storage blocked');
    };
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(blocked);
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(blocked);
    try {
      const ledger = createRoundLedger(() => 'test.games.rounds.blocked');
      ledger.add(1);
      expect(ledger.has(1)).toBe(true);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
