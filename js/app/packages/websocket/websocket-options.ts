import { WebSocketFactory } from './platform/minimal-websocket';
import type { WebsocketBuffer } from './websocket-buffer';
import type { WebsocketEventListeners } from './websocket-event';
import type { WebsocketHeartbeatOptions } from './websocket-heartbeat-options';
import type { WebsocketConnectionRetryOptions } from './websocket-retry-options';
import type {
  WebsocketData,
  WebsocketSerializer,
} from './websocket-serializer';

/**
 * Options that can be passed to the Websocket constructor.
 */
export interface WebsocketOptions<
  Send = WebsocketData,
  Receive = WebsocketData,
> {
  readonly binaryType?: BinaryType;

  /**
   * The Buffer to use.
   */
  readonly buffer?: WebsocketBuffer<Send>;

  /**
   * The options for the connection-retry-strategy.
   */
  readonly retry?: WebsocketConnectionRetryOptions;

  /**
   * The initial listeners to add to the websocket.
   */
  readonly listeners?: WebsocketEventListeners<Send, Receive>;

  /**
   * The options for the heartbeat-strategy.
   */
  readonly heartbeat?: WebsocketHeartbeatOptions;

  /**
   * The serializer to use.
   * A serializer serializes data send, and deserializes data on message-event.
   */
  readonly serializer?: WebsocketSerializer<Send, Receive>;

  /**
  * The factory to use to create the websocket.
  * Can be browser-native or a custom implementation.
  */
  readonly factory?: WebSocketFactory;
}
