/**
 * Showing the agent's screen in a call: its own desktop (the display its
 * browser and computer use are on), one share at a time, started and
 * stopped by the brain's tools. With a URL, the page opens in the agent's
 * browser, in front and full screen, first. The capture and the browser are
 * ports; the real ones are in `context/share.ts`.
 *
 * What is said out loud is said by code, not the model: "I'm sharing my
 * screen." and "Stopped sharing." Everyone on the call sees whatever the
 * agent's browser is signed in to; passwords are pasted, never shown.
 *
 * A share also sends the desktop's sound, as screen-share audio: its own
 * track, so it never reaches the agent's hearing.
 */

import type { Room } from '@livekit/rtc-node';
import type { ScreenFrame, ScreenShare } from '@macro-inc/sdk/calls/node';
import type { Trace } from '../../agent/claude.ts';
import { hostOf } from '../browser/browse.ts';
import type { CallShare, MakeShare, ShareNeeds } from './types.ts';

/** The display's frames for the track, captured off the call's thread. */
export type FrameFeed = AsyncIterable<ScreenFrame> & {
  readonly stop: () => Promise<void>;
};

/** The desktop's sound, published into a room until stopped. */
export type Sounding = {
  readonly stop: () => Promise<void>;
};

export type SharePorts = {
  /** Opens a page in the agent's browser, in front and full screen. */
  readonly show: (url: string) => Promise<void>;
  /** Starts capturing the display. */
  readonly frames: () => FrameFeed;
  /** Publishes the desktop's sound in a room. Without it a share is silent. */
  readonly sound?: (room: Room) => Promise<Sounding>;
  /** Spans: each share's start is one, with the host and whether it went up. */
  readonly trace: Trace;
};

/** What a share looks like on the wire. 10 fps: a screen, not a video. */
export const shareSettings = {
  fps: 10,
  width: 1280,
  height: 720,
} as const;

/** What the brain is told its share tools do. Whoever builds the brain's tools uses these. */
export const shareToolDocs = {
  share_screen:
    "Show your screen in this call: your desktop, with your browser, on request or when showing beats saying it. With a url, that page opens in your browser first, in front and full screen. Everyone on the call sees what your browser is signed in to, so don't share a page with anything private on it. Drive the browser while sharing with the browser capability (bin/agent openPage, clickOn, readPage). It's said out loud for you.",
  stop_share: 'Stop showing your screen in this call.',
} as const;

const sayWithin = 5_000;
const firstFrameWithin = 15_000;
const stoppedLine = 'Stopped sharing.';
const web = /^https?:\/\//;

/** The line can land seconds after the first frame, because the tool runs inside the agent's turn and `say` queues behind it: the wait is capped. */
const bounded = (saying: Promise<unknown>): Promise<unknown> =>
  Promise.race([
    saying,
    new Promise<void>((resolve) => setTimeout(resolve, sayWithin)),
  ]);

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** May the agent start sharing? Never when it joined uninvited, one share at a time, and only web pages. */
export const startRule = ({
  url,
  uninvited,
  active,
}: {
  readonly url?: string;
  readonly uninvited: boolean;
  readonly active: boolean;
}): { readonly ok: true } | { readonly ok: false; readonly rule: string } => {
  if (uninvited) return { ok: false, rule: 'uninvited' };
  if (active) return { ok: false, rule: 'already-sharing' };
  if (url !== undefined && !web.test(url)) return { ok: false, rule: 'scheme' };
  return { ok: true };
};

/** Holds only the newest frame: a reader that falls behind loses frames, never time. */
export const latestFrameQueue = (width: number, height: number) => {
  const state: { newest?: Uint8Array; wake?: () => void; ended: boolean } = {
    ended: false,
  };
  const end = (): void => {
    state.ended = true;
    state.newest = undefined;
    state.wake?.();
  };
  return {
    push: (data: Uint8Array): void => {
      if (state.ended) return;
      state.newest = data;
      state.wake?.();
    },
    stop: end,
    [Symbol.asyncIterator]: (): AsyncIterator<ScreenFrame> => ({
      next: async () => {
        while (state.newest === undefined && !state.ended)
          await new Promise<void>((resolve) => {
            state.wake = resolve;
          });
        const data = state.newest;
        if (state.ended || data === undefined)
          return { done: true, value: undefined };
        state.newest = undefined;
        return { done: false, value: { data, width, height, format: 'I420' } };
      },
      return: async () => {
        end();
        return { done: true, value: undefined };
      },
    }),
  };
};

/** One call's sharing. `needs` is the call; `ports` are the capture and the browser. */
export const callShare = (needs: ShareNeeds, ports: SharePorts): CallShare => {
  let feed: FrameFeed | undefined;
  let publication: ScreenShare | undefined;
  let sounding: Sounding | undefined;
  let active = false;
  let starting = false;
  let ending = false;
  // Every start and stop is a new generation: what an older one began, it abandons.
  let generation = 0;
  let stopping: Promise<void> | undefined;

  const refuse = (rule: string): string => {
    needs.emit('share.refused', { rule });
    return `Refused: ${rule}.`;
  };

  const stop = (reason = 'stop', callEnding = false): Promise<void> => {
    stopping ??= (async () => {
      generation++;
      ending ||= callEnding;
      const had =
        active ||
        feed !== undefined ||
        publication !== undefined ||
        sounding !== undefined;
      active = false;
      const [published, sound, source] = [publication, sounding, feed];
      publication = undefined;
      sounding = undefined;
      feed = undefined;
      await Promise.allSettled([
        published?.stop(),
        sound?.stop(),
        source?.stop(),
      ]);
      if (had) {
        needs.emit('share.stop', { reason });
        if (!ending) await bounded(needs.say(stoppedLine)).catch(() => {});
      }
    })().finally(() => {
      stopping = undefined;
    });
    return stopping;
  };

  const start = (url?: string): Promise<string> =>
    ports.trace('screen.share', async (span) => {
      if (url !== undefined) span.set('share.host', hostOf(url));
      const said = await begin(url);
      span.set('share.started', active);
      return said;
    });

  const begin = async (url?: string): Promise<string> => {
    const decision = startRule({
      url,
      uninvited: needs.uninvited,
      active: active || starting || feed !== undefined,
    });
    if (!decision.ok) return refuse(decision.rule);
    starting = true;
    const mine = ++generation;
    const current = (): boolean => generation === mine;
    const abandoned = (): Error => new Error('stopped');
    try {
      if (url !== undefined) await ports.show(url);
      if (!current()) throw abandoned();
      const frames = ports.frames();
      feed = frames;
      await bounded(needs.say("I'm sharing my screen."));
      if (!current()) throw abandoned();
      // publishScreen waits for a first frame, and a capture that never sends one would hold the tool forever.
      const noFrame = setTimeout(
        () => void stop('no-frames'),
        firstFrameWithin
      );
      const published = await needs
        .publish(needs.room(), frames, { fps: shareSettings.fps })
        .finally(() => clearTimeout(noFrame));
      publication = published;
      if (!current()) throw abandoned();
      // Sound is a bonus: a share that can't send it still shows the screen.
      if (ports.sound !== undefined)
        try {
          const sound = await ports.sound(needs.room());
          if (!current()) {
            await sound.stop();
            throw abandoned();
          }
          sounding = sound;
        } catch (error) {
          if (!current()) throw error;
          needs.emit('share.sound-failed', { error: message(error) });
        }
      active = true;
      needs.emit('share.start', {
        host: url === undefined ? '' : hostOf(url),
        sound: sounding !== undefined,
      });
      void published.stopped
        .then(() => (current() ? stop('publication-ended') : undefined))
        .catch(() => (current() ? stop('publication-error') : undefined));
      return "Sharing your screen. It's already been said out loud: don't announce it again.";
    } catch (error) {
      needs.emit('share.failed', { error: message(error) });
      await stop('start-failed');
      return refuse('start-failed');
    } finally {
      starting = false;
    }
  };

  return {
    tools: {
      share_screen: start,
      stop_share: async () => {
        await stop();
        return stoppedLine;
      },
    },
    stop: () => stop('call-end', true),
  };
};

/** Sharing for any call, over these ports. */
export const makeShare =
  (ports: SharePorts): MakeShare =>
  (needs) =>
    callShare(needs, ports);
