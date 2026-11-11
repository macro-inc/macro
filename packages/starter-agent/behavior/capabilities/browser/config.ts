/**
 * The agent's browser's settings: its port, its program and where it keeps
 * its profile. Nothing else in the area names a port or a path.
 */
import type { State } from '../../context/state.ts';

/** The owner of the browser's state directories. */
export const owner = 'browser';

export type BrowserConfig = {
  /** Its DevTools port, on loopback only. The screen area's share browser is on 9335. */
  readonly port: number;
  /** The program, by the name the image has on PATH. */
  readonly executable: string;
  /** Its profile: private, never committed, and it keeps the agent's logins. */
  readonly profile: string;
  /** Where screenshots go unless a path is given. */
  readonly screenshots: string;
};

/** Its DevTools port. */
export const browserPort = 9336;
const profileDirectory = 'profile';
const screenshotsDirectory = 'screenshots';

export const browserConfig = ({
  state,
  join,
}: {
  readonly state: Pick<State, 'private'>;
  readonly join: (...parts: readonly string[]) => string;
}): BrowserConfig => ({
  port: browserPort,
  executable: 'chromium',
  profile: join(state.private(owner), profileDirectory),
  screenshots: join(state.private(owner), screenshotsDirectory),
});

/** Where the browser's DevTools answer. Loopback only. */
export const cdpAddress = (port: number): string => `http://127.0.0.1:${port}`;
