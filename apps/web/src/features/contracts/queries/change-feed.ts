/** Tells every open store that the stored snapshot changed. */
export type ChangeFeed = {
  publish(): void;
  /** Call `listener` after another store changes the snapshot. */
  subscribe(listener: () => void): () => void;
};

/**
 * Changes across this browser's tabs and views. A broadcast channel reaches
 * other stores in the same tab at once. Another tab can receive that message
 * before its own view of localStorage has caught up, so the `storage` event,
 * which fires once it has, is followed too.
 */
export function createBrowserChangeFeed(
  channelName: string,
  storageKey: string
): ChangeFeed {
  const channel = new BroadcastChannel(channelName);

  return {
    publish: () => channel.postMessage('changed'),
    subscribe(listener) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey) listener();
      };
      channel.addEventListener('message', listener);
      window.addEventListener('storage', onStorage);

      return () => {
        channel.removeEventListener('message', listener);
        window.removeEventListener('storage', onStorage);
        channel.close();
      };
    },
  };
}
