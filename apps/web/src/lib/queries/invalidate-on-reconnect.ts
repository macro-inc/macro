import { createReconnectEffect } from '@macro-inc/collaboration/websocket';
import { ws } from '@service-connection/websocket';
import { queryClient } from './client';

export function useInvalidateQueriesOnReconnect(): void {
  createReconnectEffect(ws, () => {
    // Marks cached queries as stale and automatically refetches active queries in the background
    void queryClient.invalidateQueries();
  });
}
