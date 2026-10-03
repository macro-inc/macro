/**
 * Settled magic-chip passages, so a turn we have already resolved does not
 * fetch its session log and fold it again the next time its chip mounts.
 *
 * The hot tier is this tab's memory: a virtualized row that scrolls away and
 * back can render without waiting on disk. IndexedDB is the cold tier, for
 * the next load of the same origin. Only a turn that ended with prose is
 * stored. A chip still working or asking is never served from here.
 */

const DB_NAME = 'macro-magic-chip-resolved';
const STORE_NAME = 'chips';

/** The passage a settled turn rendered, keyed by session and turn. */
export type ResolvedMagicChip = {
  agentSessionId: string;
  turn: number;
  markdown: string;
};

const memory = new Map<string, ResolvedMagicChip>();
let opening: Promise<IDBDatabase> | undefined;
let writes: Promise<void> = Promise.resolve();

function cacheKey(agentSessionId: string, turn: number): string {
  return `${agentSessionId}:${turn}`;
}

/** Whether this environment can keep resolved passages across loads. */
export function resolvedMagicChipStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function isResolvedMagicChip(value: unknown): value is ResolvedMagicChip {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ResolvedMagicChip>;
  return (
    typeof entry.agentSessionId === 'string' &&
    typeof entry.turn === 'number' &&
    Number.isInteger(entry.turn) &&
    entry.turn >= 0 &&
    typeof entry.markdown === 'string' &&
    entry.markdown.trim().length > 0
  );
}

/** The passage this tab already resolved, without touching IndexedDB. */
export function peekResolvedMagicChip(
  agentSessionId: string,
  turn: number
): ResolvedMagicChip | undefined {
  return memory.get(cacheKey(agentSessionId, turn));
}

/**
 * The passage for this turn, from memory or IndexedDB.
 *
 * A miss, a malformed row, or a storage failure is `undefined`: the caller
 * folds. Storage trouble must not blank the chip.
 */
export async function readResolvedMagicChip(
  agentSessionId: string,
  turn: number
): Promise<ResolvedMagicChip | undefined> {
  const warm = peekResolvedMagicChip(agentSessionId, turn);
  if (warm) return warm;
  if (!resolvedMagicChipStoreAvailable()) return undefined;

  try {
    const stored = await getEntry(cacheKey(agentSessionId, turn));
    if (!isResolvedMagicChip(stored)) return undefined;
    memory.set(cacheKey(stored.agentSessionId, stored.turn), stored);
    return stored;
  } catch (error: unknown) {
    console.warn('[magic-chip] resolved cache could not be read', error);
    return undefined;
  }
}

/**
 * Remember a settled passage. The same markdown is not written twice.
 * IndexedDB failures are reported and then ignored.
 */
export function rememberResolvedMagicChip(entry: ResolvedMagicChip): void {
  if (!isResolvedMagicChip(entry)) return;
  const id = cacheKey(entry.agentSessionId, entry.turn);
  if (memory.get(id)?.markdown === entry.markdown) return;
  memory.set(id, entry);
  if (!resolvedMagicChipStoreAvailable()) return;
  enqueue(async () => {
    await putEntry(entry);
  });
}

/** Flush durable writes. Tests use this to observe a reload. */
export function flushResolvedMagicChips(): Promise<void> {
  return writes;
}

/** Drop the hot tier so the next read comes from IndexedDB. */
export function clearResolvedMagicChipMemory(): void {
  memory.clear();
}

/** Drop memory and IndexedDB. Tests use this between cases. */
export async function resetResolvedMagicChips(): Promise<void> {
  memory.clear();
  await flushResolvedMagicChips();
  if (!resolvedMagicChipStoreAvailable()) return;
  try {
    await clearStore();
  } catch (error: unknown) {
    console.warn('[magic-chip] resolved cache could not be cleared', error);
  }
}

function enqueue(operation: () => Promise<void>): void {
  const previous = writes;
  writes = runWrite(previous, operation);
}

async function runWrite(
  previous: Promise<void>,
  operation: () => Promise<void>
): Promise<void> {
  try {
    await previous;
  } catch {
    // The previous write already reported itself.
  }
  try {
    await operation();
  } catch (error: unknown) {
    console.warn('[magic-chip] resolved cache could not be written', error);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onclose = () => {
        opening = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      opening = undefined;
      reject(request.error ?? new Error('resolved cache could not be opened'));
    };
  });
  return opening;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getEntry(id: string): Promise<unknown> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  return requestResult(transaction.objectStore(STORE_NAME).get(id));
}

async function putEntry(entry: ResolvedMagicChip): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction
    .objectStore(STORE_NAME)
    .put(entry, cacheKey(entry.agentSessionId, entry.turn));
  await transactionDone(transaction);
}

async function clearStore(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).clear();
  await transactionDone(transaction);
}
