/**
 * Options for the websockets heartbeat-strategy.
 */
export interface WebsocketHeartbeatOptions {
  /** The interval in milliseconds between two pings. */
  readonly interval?: number;

  /** The timeout in milliseconds to wait for a pong after a ping. */
  readonly timeout?: number;

  /** The message to send in the ping. */
  readonly pingMessage?: string;

  /** The message to send in the pong. */
  readonly pongMessage?: string;

  /** The maximum number of missed heartbeats before the connection is considered dead. */
  readonly maxMissedHeartbeats?: number;
}

/**
 * Checks if the given options are valid heartbeat options.
 * @param options the options to check
 * @returns true if the options are valid heartbeat options, false otherwise
 */
export function isRequiredHeartbeatOptions(
  options: WebsocketHeartbeatOptions | undefined
): options is Required<WebsocketHeartbeatOptions> {
  return (
    options !== undefined &&
    options.interval !== undefined &&
    options.timeout !== undefined &&
    options.pingMessage !== undefined &&
    options.pongMessage !== undefined &&
    options.maxMissedHeartbeats !== undefined
  );
}
