/** Reopens stale connections without replaying requests or started transactions. */
export class RecoverableIDB {
  private connection?: Promise<IDBDatabase>;
  private disposed = false;

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly upgrade: (db: IDBDatabase, tx: IDBTransaction) => void,
    private readonly onVersionChange?: () => void
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
        const invalidate = () => {
          if (this.connection === opening) this.connection = undefined;
        };
        db.onclose = invalidate;
        db.onversionchange = () => {
          db.close();
          invalidate();
          this.onVersionChange?.();
        };
        if (this.disposed) {
          db.close();
          invalidate();
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
    for (let attempt = 0; ; attempt++) {
      const opening = this.open();
      const db = await opening;
      if (this.disposed)
        throw new DOMException(
          'Database connection disposed',
          'InvalidStateError'
        );
      try {
        return db.transaction(stores, mode);
      } catch (error) {
        if (
          !(error instanceof DOMException) ||
          error.name !== 'InvalidStateError'
        )
          throw error;
        if (this.connection === opening) this.connection = undefined;
        db.close();
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
