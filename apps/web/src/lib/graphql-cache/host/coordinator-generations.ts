import { fireAndForget } from '@core/util/fireAndForget';
import { APP_BUILD_TIME } from '../app-build';
import {
  generationFromCoordinatorLockName,
  newCoordinatorLockName,
} from '../worker/coordinator-protocol';
import {
  COORDINATOR_RECONNECT_TIMEOUT_MS,
  COORDINATOR_WATCH_INTERVAL_MS,
  LOCK_QUERY_TIMEOUT_MS,
} from '../worker/startup';

/** A connection attempt is over: another page found a newer coordinator. */
export class NewerCoordinatorRunsError extends Error {
  constructor() {
    super('a newer cache coordinator runs');
    this.name = 'NewerCoordinatorRunsError';
  }
}

/**
 * Which coordinator a page connects to.
 *
 * A browser can stop answering under a SharedWorker's name for as long as any
 * page of the build is open: Firefox does after the process of the page that
 * started the worker crashes. So a page that gets no answer moves to a name
 * nobody used before. A running coordinator holds a Web Lock that names its
 * generation, which is how the other pages find it, and one page at a time
 * starts a new one, so they all end up on the same.
 */
export class CoordinatorGenerations {
  private current = 0;
  /** The generation the attempt under way connects to, once picked. */
  private connecting: number | undefined;
  /** A generation this page starts, until somebody answers under it. */
  private started: number | undefined;
  /** Ends this page's turn to start a generation, or its wait for it. */
  private endTurn: (() => void) | undefined;
  private attempt = 0;

  constructor(
    readonly scope: string,
    readonly buildTime: number = APP_BUILD_TIME
  ) {}

  /** The newest one that runs, or else the last this page knew. */
  async pick(): Promise<number> {
    const { started, attempt } = this;
    const newest = (await this.running())?.at(-1);
    if (attempt !== this.attempt) return this.current;
    this.current =
      started === undefined
        ? (newest ?? this.current)
        : Math.max(started, newest ?? 0);
    this.connecting = this.current;
    return this.current;
  }

  /** Rejects once a newer one runs than the one this page connects to. */
  async untilNewerRuns(signal: AbortSignal): Promise<never> {
    for (;;) {
      await delay(COORDINATOR_WATCH_INTERVAL_MS, signal);
      if (this.connecting === undefined) continue;
      const newest = (await this.running())?.at(-1);
      if (newest !== undefined && newest > this.connecting)
        throw new NewerCoordinatorRunsError();
    }
  }

  /**
   * Nobody answered. A coordinator that runs may only be slow, so it gets every
   * attempt but the last; without one the next attempt uses a new name. Not in a
   * browser that won't say what runs, whose pages could not find one another.
   * Resolves with whether the next attempt uses a new name.
   */
  async renameUnanswered(lastAttemptNext: boolean): Promise<boolean> {
    const { current, attempt } = this;
    const running = await this.running();
    if (running === undefined || attempt !== this.attempt) return false;
    if (running.some((generation) => generation > current)) return false;
    if (running.includes(current) && !lastAttemptNext) return false;
    if (!(await this.takeTurn())) return false;
    // The page whose turn it was before may have started one.
    const runningNow = await this.running();
    if (attempt !== this.attempt) return false;
    const newest = runningNow?.at(-1);
    if (
      runningNow === undefined ||
      (newest !== undefined && newest > current)
    ) {
      this.endAttempt();
      return false;
    }
    this.started = Math.max(Date.now(), current + 1);
    return true;
  }

  /** The attempt ended, with or without an answer. */
  endAttempt(): void {
    this.attempt += 1;
    this.connecting = undefined;
    this.started = undefined;
    this.endTurn?.();
    this.endTurn = undefined;
  }

  /**
   * Waits for this page's turn, though not long: a frozen page may have it.
   * Resolves with whether the attempt goes on.
   */
  private async takeTurn(): Promise<boolean> {
    const abort = new AbortController();
    const giveUp = setTimeout(
      () => abort.abort(),
      COORDINATOR_RECONNECT_TIMEOUT_MS
    );
    const goesOn = await new Promise<boolean>((resolve) => {
      let release = () => {};
      this.endTurn = () => {
        abort.abort();
        release();
        resolve(false);
      };
      const wait = async () => {
        try {
          await navigator.locks.request(
            newCoordinatorLockName(this),
            { mode: 'exclusive', signal: abort.signal },
            () =>
              new Promise<void>((done) => {
                release = done;
                resolve(true);
              })
          );
        } catch {
          // Without a turn two pages may each start one, and the newer ends
          // the other.
          resolve(true);
        }
      };
      fireAndForget(wait(), 'graphql-cache-host');
    });
    clearTimeout(giveUp);
    return goesOn;
  }

  /** The generations that run, oldest first, if the browser says. */
  private async running(): Promise<number[] | undefined> {
    const giveUp = new AbortController();
    try {
      const { held = [] } = await Promise.race([
        navigator.locks.query(),
        noAnswer(LOCK_QUERY_TIMEOUT_MS, giveUp.signal),
      ]);
      return held
        .flatMap(({ name, mode }) =>
          // A shared one is a page's that was only told the holder is gone.
          name === undefined || mode === 'shared'
            ? []
            : (generationFromCoordinatorLockName(this, name) ?? [])
        )
        .sort((left, right) => left - right);
    } catch {
      return undefined;
    } finally {
      giveUp.abort();
    }
  }
}

/** Rejects after `ms`, or when `signal` aborts. */
const noAnswer = async (ms: number, signal: AbortSignal): Promise<never> => {
  await delay(ms, signal);
  throw new Error('the browser does not list its locks');
};

/** Rejects when `signal` aborts. */
const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort);
  });
