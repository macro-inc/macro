import {
  type DBSchema,
  type IDBPDatabase,
  type OpenDBCallbacks,
  openDB,
  type StoreNames,
} from 'idb';

/** Keeps a connection only while it is usable. Recovery never replays writes. */
export class RecoverableDatabase<Schema extends DBSchema> {
  private connection?: Promise<IDBPDatabase<Schema>>;

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly upgrade: OpenDBCallbacks<Schema>['upgrade']
  ) {}

  private async open(): Promise<IDBPDatabase<Schema>> {
    if (this.connection) return this.connection;

    const connection = openDB<Schema>(this.name, this.version, {
      upgrade: this.upgrade,
      terminated: () => {
        if (this.connection === connection) this.connection = undefined;
      },
    });
    this.connection = connection;
    try {
      const db = await connection;
      db.addEventListener('versionchange', () => {
        db.close();
        if (this.connection === connection) this.connection = undefined;
      });
      return db;
    } catch (error) {
      if (this.connection === connection) this.connection = undefined;
      throw error;
    }
  }

  async transaction<
    Name extends StoreNames<Schema>,
    Mode extends IDBTransactionMode,
  >(store: Name, mode: Mode) {
    for (let attempt = 0; ; attempt++) {
      const db = await this.open();
      try {
        return db.transaction(store, mode);
      } catch (error) {
        if (
          !(error instanceof DOMException) ||
          error.name !== 'InvalidStateError'
        ) {
          throw error;
        }
        // Only transaction creation is retried: no request has run yet, so an
        // auto-increment WAL append cannot be duplicated by recovery.
        const connection = this.connection;
        if (
          connection &&
          (await connection) === db &&
          this.connection === connection
        ) {
          this.connection = undefined;
        }
        db.close();
        if (attempt === 1) throw error;
      }
    }
  }
}
