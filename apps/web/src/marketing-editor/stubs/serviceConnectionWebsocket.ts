/**
 * Stub for @service-connection/websocket, swapped in by the demo's Vite config.
 *
 * The real module builds a connection-gateway socket at module scope and, on
 * the way up, calls fetchToken() — which is the /jwt/refresh retry loop the
 * shipped bundle needed a CSP tag to suppress. It is reached from the editor
 * through MentionsMenu -> mentionsUtils -> bulkUpload, so merely rendering the
 * @ menu was enough to start it.
 *
 * Live indicators, comment sync and query invalidation all hang off this
 * socket. None of them have anything to drive them in a single-player demo, so
 * the effect creators register nothing rather than registering a listener that
 * can never fire.
 */
import { WebsocketConnectionState } from '@macro-inc/collaboration/websocket';
import { createInertSocket } from './inertSocket';

// Pure JSON parsing with no module-scope work of its own, so the demo uses the
// real implementation rather than a second copy that could drift from it.
export { parseWebsocketPayload } from '@service-connection/websocket-payload';

export type FromWebsocketMessage = {
  type: string;
  data: any;
};

/** The demo never opens a socket, so the type is only ever used positionally. */
export type ConnectionGatewayWebsocket = ReturnType<typeof createInertSocket>;

export const ws = createInertSocket();

/** Permanently closed: consumers that branch on state take the offline path. */
export const state = () => WebsocketConnectionState.Closed;

export function createConnectionBlockWebsocketEffect(
  _callback: (data: FromWebsocketMessage) => void
) {}

export function createConnectionWebsocketEffect(
  _callback: (data: FromWebsocketMessage) => void
) {}
