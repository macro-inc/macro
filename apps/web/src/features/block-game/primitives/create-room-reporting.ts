import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
import type { GameStatus } from '../core/status';
import type { RoundResult } from '../core/turn-match';

/** How long a status must hold before it is published, to absorb quick flips. */
const STATUS_SETTLE_MS = 1_500;
/** Other editors publish later, only in case the leading client could not. */
const STATUS_FALLBACK_MS = 6_000;
/** A round report that did not get through is retried after these delays. */
const REPORT_RETRY_MS = [2_000, 10_000, 30_000];
/** How many unreported rounds a room remembers for its player. */
const LEDGER_LIMIT = 50;

/**
 * Publish the room's status whenever it settles on a new value. Every editor
 * derives the same value; the client that caused the change publishes first,
 * and the rest follow up later in case it went offline.
 */
export function createStatusPublisher(options: {
  status: Accessor<GameStatus | undefined>;
  enabled: Accessor<boolean>;
  /** Whether this client caused the latest change. */
  leads: Accessor<boolean>;
  /** Resolves true once the status is stored. */
  publish: (status: GameStatus) => Promise<boolean>;
}) {
  let published: GameStatus | undefined;
  let settled: GameStatus | undefined;
  let queue: Promise<void> = Promise.resolve();

  // Writes run one at a time and each sends the latest settled value, so a
  // slow earlier write can never land after a newer one.
  function publishSettled() {
    queue = queue.then(async () => {
      const status = settled;
      if (!status || status === published) return;
      try {
        if (await options.publish(status)) published = status;
      } catch (cause) {
        // The next change retries; a failure must not stall later writes.
        console.error('Failed to publish game status', cause);
      }
    });
  }

  // Memoized so the settle timer restarts only when the value changes, not
  // on every move or clock tick behind it.
  const current = createMemo(() =>
    options.enabled() ? options.status() : undefined
  );
  createEffect(
    on(current, (status) => {
      if (!status || status === published) return;
      const delay = options.leads() ? STATUS_SETTLE_MS : STATUS_FALLBACK_MS;
      const timer = setTimeout(() => {
        settled = status;
        publishSettled();
      }, delay);
      onCleanup(() => clearTimeout(timer));
    })
  );
}

/** Rounds a client saw its player take part in and has not yet reported. */
export type RoundLedger = {
  has(round: number): boolean;
  add(round: number): void;
  delete(round: number): void;
};

/**
 * A round ledger kept in local storage, so a round that ends while its player
 * is away can still be reported on their next visit. Falls back to memory
 * when storage is unavailable.
 */
export function createRoundLedger(key: Accessor<string>): RoundLedger {
  const memory = new Map<string, number[]>();
  const load = (): number[] => {
    const cached = memory.get(key());
    if (cached) return cached;
    let rounds: number[] = [];
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key()) ?? '[]');
      if (Array.isArray(parsed))
        rounds = parsed.filter((round): round is number =>
          Number.isInteger(round)
        );
    } catch {
      // Unreadable or unavailable storage starts empty.
    }
    memory.set(key(), rounds);
    return rounds;
  };
  const save = (rounds: number[]) => {
    const kept = rounds.slice(-LEDGER_LIMIT);
    memory.set(key(), kept);
    try {
      localStorage.setItem(key(), JSON.stringify(kept));
    } catch {
      // The memory copy still covers this visit.
    }
  };
  return {
    has: (round) => load().includes(round),
    add: (round) => {
      const rounds = load();
      if (!rounds.includes(round)) save([...rounds, round]);
    },
    delete: (round) => save(load().filter((kept) => kept !== round)),
  };
}

/**
 * Report finished rounds from their players' clients; a round counts once two
 * players' reports agree. A client vouches only for rounds it saw in progress
 * with its player seated, so opening a room never confirms a result written
 * while the player was away, yet a round that ended in their absence is still
 * reported on their next visit. A report that does not get through is retried
 * a few times, and the round stays in the ledger until one does.
 */
export function createRoundReporter(options: {
  results: Accessor<RoundResult[]>;
  /** The round being played while this client's player holds a seat. */
  seatedRound: Accessor<number | undefined>;
  userId: Accessor<string | undefined>;
  enabled: Accessor<boolean>;
  ledger: RoundLedger;
  /** Resolves false when the report did not get through. */
  report: (result: RoundResult) => Promise<boolean>;
}) {
  const sent = new Set<number>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    for (const retry of retries) clearTimeout(retry);
  });

  const send = async (result: RoundResult, attempt: number) => {
    const delivered = await options.report(result).catch(() => false);
    if (delivered) {
      options.ledger.delete(result.round);
      return;
    }
    if (disposed || attempt >= REPORT_RETRY_MS.length) return;
    const retry = setTimeout(() => {
      retries.delete(retry);
      void send(result, attempt + 1);
    }, REPORT_RETRY_MS[attempt]);
    retries.add(retry);
  };

  createEffect(
    on(
      () => (options.enabled() ? options.seatedRound() : undefined),
      (round) => {
        if (round !== undefined) options.ledger.add(round);
      }
    )
  );

  createEffect(
    on(
      () => (options.enabled() ? options.results() : undefined),
      (results) => {
        if (!results) return;
        const userId = options.userId();
        for (const result of results) {
          if (sent.has(result.round) || !options.ledger.has(result.round))
            continue;
          if (!userId || !result.players.includes(userId)) continue;
          sent.add(result.round);
          void send(result, 0);
        }
      }
    )
  );
}
