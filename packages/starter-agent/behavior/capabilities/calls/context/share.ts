/**
 * Sharing's real ports: the desktop's capture and sound, and the agent's
 * browser to put a page in front. Built once; every call's sharing is made
 * from them.
 */
import type { Base } from '../../../context/index.ts';
import { browserPorts } from '../../browser/context.ts';
import { makeShare, type SharePorts } from '../share.ts';
import type { MakeShare } from '../types.ts';
import { desktop } from './desktop.ts';
import { workerFrames } from './share-feed.ts';

/** The display a share captures: the agent's own. */
const displayVariable = 'DISPLAY';

export const sharePorts = (base: Base): SharePorts => {
  const display = process.env[displayVariable] ?? '';
  const browser = browserPorts(base);
  return {
    show: (url) =>
      browser.withTab(async (tab) => {
        await tab.goto(url);
        await tab.fullscreen();
      }),
    frames: () => {
      if (display === '') throw new Error('no DISPLAY to share');
      return workerFrames(display);
    },
    // LiveKit's native library loads with the first share, never in the agent's main process.
    sound: async (room) =>
      (await import('./share-sound.ts')).recordSound(desktop(display))(room),
    trace: base.trace,
  };
};

/** Sharing for a call, over the real desktop: what a call's process is handed. */
export const realShare = (base: Base): MakeShare => makeShare(sharePorts(base));

/** What the `share` key of the context holds. */
export type Share = {
  /** Makes one call's sharing from what the call gives it. */
  readonly make: MakeShare;
};

export const shareContext = (base: Base): Share => ({ make: realShare(base) });
