/** Errors WebKit raises when it suspends or drops a connection under a running transaction. */
const INTERRUPTIONS = new Set([
  'AbortError',
  'InvalidStateError',
  'TransactionInactiveError',
  'UnknownError',
]);
const RUN_ATTEMPTS = 3;

class Interrupted extends Error {
  constructor(readonly error: DOMException) {
    super(error.message);
  }
}

/** Reopens stale connections; only `run` replays a started transaction. */
export class RecoverableIDB {
  private connection?: Promise<IDBDatabase>;
  private disposed = false;

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly upgrade: (db: IDBDatabase, tx: IDBTransaction) => void,
    private readonly onVersionChange?: () => void,
    /** A connection closed or a transaction was interrupted underneath its owner. */
    private readonly onConnectionLost?: () => void
  ) {}

  open(): Promise<IDBDatabase> {
    if (this.disposed)
      throw new DOMException(
        'Database connection disposed',
        'InvalidStateError'
      );
    if (this.connection) return this.connection;
    const request = indexedDB.open(this.name, this.version);
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () =>
        this.upgrade(request.result, request.transaction!);
      request.onerror = () => {
        if (this.connection === opening) this.connection = undefined;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          if (this.connection !== opening) return;
          this.connection = undefined;
          this.onConnectionLost?.();
        };
        db.onversionchange = () => {
          db.close();
          if (this.connection === opening) this.connection = undefined;
          this.onVersionChange?.();
        };
        if (this.disposed) {
          db.close();
          if (this.connection === opening) this.connection = undefined;
          reject(
            new DOMException(
              'Database connection disposed',
              'InvalidStateError'
            )
          );
          return;
        }
        resolve(db);
      };
    });
    this.connection = opening;
    return opening;
  }

  async transaction(stores: string | string[], mode: IDBTransactionMode) {
    return (await this.begin(stores, mode)).tx;
  }

  /**
   * Runs `body` in one transaction and resolves with the value it passes to
   * `finish` once the transaction commits. When the platform aborts the
   * transaction after it started, the connection is replaced and `body` runs
   * again from the start, a bounded number of times. An aborted transaction
   * commits nothing, but a commit can land after the page saw the abort, so
   * `body` must read the state it depends on inside the transaction and be
   * safe to repeat. Report domain failures through the value, not
   * `tx.abort()`, which looks like an interruption. A body that throws, or
   * whose request callback throws, is not replayed.
   */
  async run<T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction, finish: (value: T) => void) => void
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const { tx, opening } = await this.begin(stores, mode);
      try {
        return await settle(tx, body);
      } catch (error) {
        if (!(error instanceof Interrupted)) throw error;
        if (this.connection === opening) this.connection = undefined;
        tx.db.close();
        this.onConnectionLost?.();
        if (attempt === RUN_ATTEMPTS || this.disposed) throw error.error;
      }
    }
  }

  private async begin(stores: string | string[], mode: IDBTransactionMode) {
    for (let attempt = 0; ; attempt++) {
      const opening = this.open();
      const db = await opening;
      if (this.disposed)
        throw new DOMException(
          'Database connection disposed',
          'InvalidStateError'
        );
      try {
        return { tx: db.transaction(stores, mode), opening };
      } catch (error) {
        if (
          !(error instanceof DOMException) ||
          error.name !== 'InvalidStateError'
        )
          throw error;
        if (this.connection === opening) this.connection = undefined;
        db.close();
        this.onConnectionLost?.();
        // Creation failed before any requests ran, so a single retry is safe.
        if (attempt === 1) throw error;
      }
    }
  }

  /** Terminal close: pending opens cannot revive a disposed owner. */
  async close(): Promise<void> {
    this.disposed = true;
    const opening = this.connection;
    this.connection = undefined;
    try {
      (await opening)?.close();
    } catch {
      // A failed open has no connection to close; its caller observes the error.
    }
  }
}

function settle<T>(
  tx: IDBTransaction,
  body: (tx: IDBTransaction, finish: (value: T) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let value: T;
    let thrown: { error: unknown } | undefined;
    let requestError: DOMException | null = null;
    tx.oncomplete = () => resolve(value);
    // A request error bubbles before `tx.error` is set and before rollback
    // finishes. Settle only on abort, so callers see the real cause and a
    // replay never starts while the old transaction is still rolling back.
    tx.onerror = (event) => {
      requestError ??= (event.target as IDBRequest | null)?.error ?? null;
    };
    tx.onabort = () => {
      if (thrown) {
        reject(thrown.error);
        return;
      }
      // WebKit fails pending requests before it sets `tx.error`, often to null.
      const cause =
        tx.error ??
        requestError ??
        new DOMException('The transaction was aborted', 'AbortError');
      // An exception thrown in a request callback aborts with a non-null
      // AbortError. That is a bug in the body, so it is never replayed.
      const interrupted =
        INTERRUPTIONS.has(cause.name) && tx.error?.name !== 'AbortError';
      reject(interrupted ? new Interrupted(cause) : cause);
    };
    try {
      body(tx, (next) => {
        value = next;
      });
    } catch (error) {
      thrown = { error };
      tx.abort();
    }
  });
}
