/**
 * Macro, as the agent's own account. `macroClient` is a lazy SDK client;
 * `stayOnline` shows the account as online; chat is in its own directory
 * (`./chat`). A call's share lives in the agent (the starter agent's calls).
 *
 *     const apiKey = () => credentials.get("MACRO_API_KEY");
 *     const macro = macroClient({ apiKey });
 *     const online = stayOnline({ apiKey });
 *     behavior().use(chat({ macro }))
 */
import { Macro } from '@macro-inc/sdk';

/** Macro's connection gateway, which presence is a socket to. */
export const gateway = 'wss://gateway.macro.com/connection-gateway/';

/** The SDK client, made on first use from the account's API key. */
export const macroClient = ({
  apiKey,
}: {
  readonly apiKey: () => Promise<string>;
}): (() => Promise<Macro>) => {
  let client: Promise<Macro> | undefined;
  return () => {
    client ??= apiKey()
      .then((key) => new Macro({ auth: { type: 'user', apiKey: key } }))
      .catch((error: unknown) => {
        client = undefined;
        throw error;
      });
    return client;
  };
};

export type Presence = {
  /** Goes offline, and stops reconnecting. */
  readonly stop: () => void;
};

const firstWait = 1_000;
const longestWait = 60_000;
const pingEvery = 25_000;

/** The wait after a drop: double, capped at a minute. */
export const nextWait = (wait: number): number =>
  Math.min(wait * 2, longestWait);

/**
 * Keeps the account "online" in Macro. Presence is a live socket to the
 * connection gateway, kept by a text "ping": the gateway drops a connection
 * after 60s without one. Reconnects until stopped, with a doubling wait.
 */
export const stayOnline = ({
  apiKey,
  url = gateway,
  ping = pingEvery,
  onChange = () => {},
}: {
  readonly apiKey: () => Promise<string>;
  readonly url?: string;
  readonly ping?: number;
  /** Told each time the account goes online or offline, e.g. for a log. */
  readonly onChange?: (
    change:
      | { readonly online: true }
      | {
          readonly online: false;
          readonly code: number;
          readonly reason: string;
        }
  ) => void;
}): Presence => {
  let wait = firstWait;
  let stopped = false;
  let current: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const again = (code: number, reason: string) => {
    onChange({ online: false, code, reason });
    if (stopped) return;
    retry = setTimeout(connect, wait);
    wait = nextWait(wait);
  };

  const connect = (): void => {
    void apiKey().then(
      (key) => {
        if (stopped) return;
        const socket = new WebSocket(url, {
          headers: { 'x-macro-user-api-key': key },
        });
        current = socket;
        let pinging: ReturnType<typeof setInterval> | undefined;
        socket.addEventListener('open', () => {
          wait = firstWait;
          onChange({ online: true });
          socket.send('ping');
          pinging = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) socket.send('ping');
          }, ping);
        });
        socket.addEventListener('close', ({ code, reason }) => {
          clearInterval(pinging);
          again(code, reason);
        });
      },
      (error: unknown) =>
        again(0, error instanceof Error ? error.message : String(error))
    );
  };

  connect();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(retry);
      current?.close();
    },
  };
};
