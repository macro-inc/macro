/**
 * The agent's browser's settings: where it answers, and where screenshots go.
 * Nothing else in the area names a port or a path.
 */
import type { State } from '../../context/state.ts';

/** The owner of the browser's state directories. */
export const owner = 'browser';

/**
 * The DevTools port of the computer's Chromium (the image's
 * `macro-agent-browser` service), on loopback only.
 */
export const browserPort = 9223;

export type BrowserConfig = {
  /** Where its DevTools answer. */
  readonly endpoint: string;
  /** Where screenshots go unless a path is given. */
  readonly screenshots: string;
};

const screenshotsDirectory = 'screenshots';

/** Where a browser's DevTools answer. Loopback only. */
export const cdpAddress = (port: number): string => `http://127.0.0.1:${port}`;

export const browserConfig = ({
  state,
  join,
}: {
  readonly state: Pick<State, 'private'>;
  readonly join: (...parts: readonly string[]) => string;
}): BrowserConfig => ({
  endpoint: cdpAddress(browserPort),
  screenshots: join(state.private(owner), screenshotsDirectory),
});
