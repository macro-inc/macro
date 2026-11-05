// Online and typing. Presence is a websocket to the connection gateway kept
// alive by a text "ping" (the gateway drops a connection after 60s without
// one), reconnecting with doubling backoff. Typing re-sends "start" every few
// seconds (indicators expire), sends "stop" once, and never runs forever.
import { API_KEY_HEADER } from './macro.ts';

export type Socket = Pick<
  WebSocket,
  'readyState' | 'send' | 'close' | 'onopen' | 'onclose' | 'onerror'
>;

export type OpenSocket = (url: string, apiKey: string) => Socket;

export const openGatewaySocket: OpenSocket = (url, apiKey) =>
  new WebSocket(url, { headers: { [API_KEY_HEADER]: apiKey } });

export type PresenceOptions = {
  url: string;
  apiKey: string;
  open: OpenSocket;
  log(line: object): void;
  pingMilliseconds?: number;
};

/** Stay online until the returned stop function runs. */
export function stayOnline(options: PresenceOptions): () => void {
  let delay = 1_000;
  let stopped = false;
  let socket: Socket | null = null;
  let ping: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    const opened = options.open(options.url, options.apiKey);
    socket = opened;
    opened.onopen = () => {
      delay = 1_000;
      options.log({ presence: 'online' });
      opened.send('ping');
      ping = setInterval(() => {
        if (opened.readyState === 1) opened.send('ping');
      }, options.pingMilliseconds ?? 25_000);
    };
    opened.onclose = () => {
      clearInterval(ping);
      if (stopped) return;
      options.log({ presence: 'offline', retry_in_ms: delay });
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 60_000);
    };
    opened.onerror = () => {};
  };
  connect();

  return () => {
    stopped = true;
    clearInterval(ping);
    clearTimeout(retry);
    socket?.close();
  };
}

export type TypingOptions = {
  everyMilliseconds?: number;
  maxMilliseconds?: number;
  log(line: object): void;
};

/** Start typing; the returned stop sends "stop" once and resolves after it. */
export function startTyping(
  send: (active: boolean) => Promise<void>,
  options: TypingOptions
): () => Promise<void> {
  const quietly = (active: boolean) =>
    send(active).catch((error) =>
      options.log({ typing_failed: String(error), active })
    );

  const tick = setInterval(
    () => quietly(true),
    options.everyMilliseconds ?? 4_000
  );
  let stopped: Promise<void> | undefined;
  const stop = () => {
    stopped ??= (async () => {
      clearInterval(tick);
      clearTimeout(cap);
      await quietly(false);
    })();
    return stopped;
  };
  const cap = setTimeout(stop, options.maxMilliseconds ?? 10 * 60_000);
  quietly(true);
  return stop;
}
