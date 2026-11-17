/**
 * Tells Macro the agent is up (`POST /team_agents/me/online` on the auth
 * service). Until the first report its row reads "Starting" and its inviter
 * hasn't been told it is ready. Called each time presence opens; reports
 * once per run, retrying with a doubling wait (capped at a minute) until
 * the server takes it.
 */
import { nextWait } from './presence.ts';

/** The route, under the auth service's host. */
export const onlineRoute = '/team_agents/me/online';

const firstWait = 1_000;

export type OnlineReport = {
  /** Report, unless this run already has. */
  readonly report: () => void;
};

export const reportsOnline = ({
  post,
  log,
  wait = firstWait,
}: {
  /** Sends the report; the HTTP status it got. */
  readonly post: () => Promise<number>;
  readonly log: (entry: object) => void;
  readonly wait?: number;
}): OnlineReport => {
  let state: 'idle' | 'sending' | 'done' = 'idle';
  let delay = wait;

  const attempt = (): void => {
    void post().then(
      (status) => {
        if (status < 300) {
          state = 'done';
          log({ online: 'reported', status });
          return;
        }
        // A 404 too: this code can ship before the auth service that has
        // the route. The wait caps at a minute, so an account that isn't an
        // agent teammate costs one request a minute.
        again({ status });
      },
      (error: unknown) =>
        again({ error: error instanceof Error ? error.message : String(error) })
    );
  };

  const again = (entry: object): void => {
    log({ online: 'retrying', ...entry });
    setTimeout(attempt, delay);
    delay = nextWait(delay);
  };

  return {
    report: () => {
      if (state !== 'idle') return;
      state = 'sending';
      attempt();
    },
  };
};
