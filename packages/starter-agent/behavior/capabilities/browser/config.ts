/**
 * The agent's browser's settings: where it answers (from startup), and where
 * screenshots go. Nothing else in the area names a path.
 */
import type { State } from '../../context/state.ts';

/** The owner of the browser's state directories. */
export const owner = 'browser';

export type BrowserConfig = {
  /** Where its DevTools answer. */
  readonly endpoint: string;
  /** Where screenshots go unless a path is given. */
  readonly screenshots: string;
};

const screenshotsDirectory = 'screenshots';

export const browserConfig = ({
  browserEndpoint,
  state,
  join,
}: {
  /** Its DevTools endpoint, from startup (`MUPPET_BROWSER_CDP_URL`). */
  readonly browserEndpoint: string;
  readonly state: Pick<State, 'private'>;
  readonly join: (...parts: readonly string[]) => string;
}): BrowserConfig => ({
  endpoint: browserEndpoint,
  screenshots: join(state.private(owner), screenshotsDirectory),
});
