import type { Page, WebSocketRoute } from '@playwright/test';

/** Answers the gateway heartbeat without connecting to an upstream socket. */
export function silenceGateway(
  page: Page,
  connected?: (socket: WebSocketRoute) => void
): Promise<void> {
  return page.routeWebSocket(/\/connection-gateway(\/|\?|$)/, (socket) => {
    socket.onMessage((message) => {
      if (message === 'ping') socket.send('pong');
    });
    connected?.(socket);
  });
}
