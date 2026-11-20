/**
 * The agent's browser's settings: where it answers (from startup), and where
 * screenshots go. Nothing else in the area names a path.
 */
import type { Config } from '../../context/config.ts';
import type { State } from '../../context/state.ts';

/** The owner of the browser's state directories. */
export const owner = 'browser';

export type BrowserConfig = {
  /** Where its DevTools answer. */
  readonly endpoint: string;
  /** Where screenshots go unless a path is given. */
  readonly screenshots: string;
  /** The harness's take-over file: present while the owner drives the screen. */
  readonly screenDriver: string;
  /** The CAPTCHA solver's lease on the browser. */
  readonly solverLease: string;
};

const screenshotsDirectory = 'screenshots';
/** Where the harness writes the owner's take-over, under the agent's home (agent-screen core). */
const screenDriverPath = ['state', 'screen-driver'] as const;
const solverLeaseFile = 'solver-lease.json';

export const browserConfig = ({
  browserEndpoint,
  state,
  config,
  join,
}: {
  /** Its DevTools endpoint, from startup (`MUPPET_BROWSER_CDP_URL`). */
  readonly browserEndpoint: string;
  readonly state: Pick<State, 'private' | 'run'>;
  readonly config: Pick<Config, 'home'>;
  readonly join: (...parts: readonly string[]) => string;
}): BrowserConfig => ({
  endpoint: browserEndpoint,
  screenshots: join(state.private(owner), screenshotsDirectory),
  screenDriver: join(config.home, ...screenDriverPath),
  solverLease: join(state.run(owner), solverLeaseFile),
});
