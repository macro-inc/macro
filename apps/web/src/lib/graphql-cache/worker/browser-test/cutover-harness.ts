import { createWorkerCacheHost } from '../../host/worker-host';

const resultNode = document.querySelector('#result');
if (!(resultNode instanceof HTMLElement))
  throw new Error('missing result node');

const scope = `wp10-cutover-${crypto.randomUUID()}`;
const legacyName = `graphql-cache:${scope}`;
const unrelatedName = `unrelated-idb:${scope}`;
const STORE = 'records';
const MARKER_KEY = 'keep';
const MARKER_VALUE = 'unrelated-data';

const openDatabase = (
  name: string,
  initialize?: (database: IDBDatabase) => void
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => initialize?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IDB open failed'));
  });

const writeMarker = (database: IDBDatabase): Promise<void> =>
  new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(MARKER_VALUE, MARKER_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IDB marker write failed'));
    transaction.onabort = transaction.onerror;
  });

const readMarker = (database: IDBDatabase): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE, 'readonly')
      .objectStore(STORE)
      .get(MARKER_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IDB marker read failed'));
  });

const databaseExists = async (name: string): Promise<boolean> =>
  (await indexedDB.databases()).some((database) => database.name === name);

const waitUntil = async (
  label: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 20_000
): Promise<void> => {
  const deadline = performance.now() + timeoutMs;
  while (!(await predicate())) {
    if (performance.now() >= deadline) throw new Error(`${label} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const deleteDatabase = (name: string): Promise<void> =>
  new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });

const report: Record<string, unknown> = {
  passed: false,
  noEagerDeletion: false,
  deletionRequestedOnFirstUse: false,
  blockedDeletionDidNotBlockHost: false,
  legacyDeletionCompletedLater: false,
  unrelatedIdbPreserved: false,
};

let legacy: IDBDatabase | undefined;
let unrelated: IDBDatabase | undefined;
try {
  legacy = await openDatabase(legacyName, (database) => {
    database.createObjectStore(STORE);
  });
  unrelated = await openDatabase(unrelatedName, (database) => {
    database.createObjectStore(STORE);
  });
  await writeMarker(unrelated);

  let legacyVersionChange = false;
  legacy.onversionchange = () => {
    legacyVersionChange = true;
    // Deliberately remain open so the cutover request reaches `blocked`.
  };

  const host = createWorkerCacheHost({ scope, requestTimeoutMs: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  report.noEagerDeletion = !legacyVersionChange;

  await host.clear();
  report.deletionRequestedOnFirstUse = legacyVersionChange;
  report.blockedDeletionDidNotBlockHost = await databaseExists(legacyName);

  legacy.close();
  legacy = undefined;
  await waitUntil(
    'legacy normalized cache deletion',
    async () => !(await databaseExists(legacyName))
  );
  report.legacyDeletionCompletedLater = true;
  report.unrelatedIdbPreserved =
    (await databaseExists(unrelatedName)) &&
    (await readMarker(unrelated)) === MARKER_VALUE;

  host.dispose();
  report.passed = Object.entries(report)
    .filter(([key]) => key !== 'passed')
    .every(([, value]) => value === true);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  legacy?.close();
  unrelated?.close();
  await deleteDatabase(legacyName);
  await deleteDatabase(unrelatedName);
}

resultNode.dataset.status = report.passed ? 'passed' : 'failed';
resultNode.textContent = JSON.stringify(report);
