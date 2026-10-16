type RealtimeConnection = {
  pause(): void;
  restart(): void;
};

const connections = new Set<RealtimeConnection>();
let sessionActive = true;

/** Keep newly created clients paused while native logout retains the webview. */
export function registerGraphqlSoupRealtimeConnection(
  connection: RealtimeConnection
): () => void {
  connections.add(connection);
  if (!sessionActive) connection.pause();
  return () => connections.delete(connection);
}

/** Fence callbacks and retries before clearing the current account's caches. */
export function pauseGraphqlSoupRealtimeSession(): void {
  sessionActive = false;
  for (const connection of connections) connection.pause();
}

/** Login can replace an identity without recreating the native app's clients. */
export function restartGraphqlSoupRealtimeSession(): void {
  sessionActive = true;
  for (const connection of connections) connection.restart();
}
