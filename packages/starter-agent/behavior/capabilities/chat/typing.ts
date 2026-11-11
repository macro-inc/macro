/**
 * Shows the agent typing while it works on a reply, until the reply posts.
 * Indicators expire, so "start" is sent again every few seconds; "stop" is
 * sent once; and it never types forever.
 */
export type Typing = {
  /** Shows the agent typing in the channel, in a thread if `root` is given, until stopped. */
  readonly start: (channelId: string, root?: string) => void;
  /** Stops it. Resolves once "stop" is sent, at once if it wasn't typing there. */
  readonly stop: (channelId: string) => Promise<void>;
};

const resendEvery = 4_000;
const longest = 10 * 60_000;

export const typing = ({
  send,
  every = resendEvery,
  most = longest,
}: {
  readonly send: (
    channelId: string,
    action: 'start' | 'stop',
    root?: string
  ) => Promise<void>;
  readonly every?: number;
  readonly most?: number;
}): Typing => {
  const stops = new Map<string, () => Promise<void>>();
  const stop = (channelId: string) =>
    stops.get(channelId)?.() ?? Promise.resolve();
  return {
    stop,
    start: (channelId, root) => {
      void stop(channelId);
      const quiet = (action: 'start' | 'stop') =>
        send(channelId, action, root).catch(() => undefined);
      const tick = setInterval(() => void quiet('start'), every);
      let stopped: Promise<void> | undefined;
      const end = () => {
        stopped ??= (async () => {
          clearInterval(tick);
          clearTimeout(cap);
          if (stops.get(channelId) === end) stops.delete(channelId);
          await quiet('stop');
        })();
        return stopped;
      };
      const cap = setTimeout(() => void end(), most);
      stops.set(channelId, end);
      void quiet('start');
    },
  };
};
