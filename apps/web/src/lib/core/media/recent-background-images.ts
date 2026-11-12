import { RecoverableIDB } from '../../persistence/recoverable-idb';

/** The JPEG data URLs produced by readBackgroundImage are bounded before persistence. */
export const MAX_RECENT_IMAGES = 5;
export const MAX_RECENT_IMAGE_LENGTH = 2 * 1024 * 1024;
const STORE = 'images';
const database = new RecoverableIDB(
  'macro-recent-background-images',
  1,
  (db) => {
    db.createObjectStore(STORE);
  }
);

export type RecentBackgroundImage = { id: string; path: string };

export function loadRecentBackgroundImages(): Promise<RecentBackgroundImage[]> {
  return database.run(STORE, 'readonly', (tx, finish) => {
    const request = tx.objectStore(STORE).get('recent');
    request.onsuccess = () => finish(request.result ?? []);
  });
}

export async function saveRecentBackgroundImage(image: RecentBackgroundImage) {
  if (image.path.length > MAX_RECENT_IMAGE_LENGTH) return null;
  return database.run<RecentBackgroundImage[]>(
    STORE,
    'readwrite',
    (tx, finish) => {
      const store = tx.objectStore(STORE);
      const request = store.get('recent');
      request.onsuccess = () => {
        const recent: RecentBackgroundImage[] = request.result ?? [];
        const next = [
          image,
          ...recent.filter((item) => item.path !== image.path),
        ].slice(0, MAX_RECENT_IMAGES);
        store.put(next, 'recent');
        finish(next);
      };
    }
  );
}

export function removeRecentBackgroundImage(path: string) {
  return database.run<RecentBackgroundImage[]>(
    STORE,
    'readwrite',
    (tx, finish) => {
      const store = tx.objectStore(STORE);
      const request = store.get('recent');
      request.onsuccess = () => {
        const recent: RecentBackgroundImage[] = request.result ?? [];
        const next = recent.filter((item) => item.path !== path);
        store.put(next, 'recent');
        finish(next);
      };
    }
  );
}
