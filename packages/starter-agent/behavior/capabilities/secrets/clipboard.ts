/**
 * The computer's clipboard, on the X display the agent's computer shows
 * (DISPLAY, which every child inherits).
 *
 * A copied value is served by a child process that reads it from stdin
 * (never its arguments) and holds the X selection: `xclip -loops 1` stops
 * after the first paste, and `timeout` ends it after 20 seconds. The X
 * server forgets a selection when its owner ends, so either way the
 * clipboard is cleared. That is also why a newer clipboard is never cleared:
 * once anyone else copies, they own the selection and our child has
 * already lost it (xclip exits when it does), so ending it touches nothing
 * of theirs. The next copy replaces ours the same way.
 *
 * Typing into a focused password field is not done in v1: there is no
 * reliable way here to know the focused field is a password field.
 */
import type { Clock } from '@macro-inc/muppet/utilities/time';
import type { Shell } from '../../context/shell.ts';
import { clipboard as limits } from './config.ts';

export type Clipboard = {
  /** Puts `value` on the clipboard, for one paste or until it times out: after 20 seconds, or `ttlMs` if sooner. */
  readonly put: (value: string, ttlMs?: number) => Promise<void>;
  /** The text on the clipboard now. Throws if there is none. */
  readonly take: () => Promise<string>;
};

/** How long a server that fails at once (no xclip, no display) takes to say so. */
const settleMs = 150;

/** `timeout`'s duration, in seconds to the millisecond, never past the clipboard's limit. */
const seconds = (ttlMs: number | undefined): string =>
  String(Math.floor(Math.min(ttlMs ?? Infinity, limits.seconds * 1000)) / 1000);

const serve = (ttlMs: number | undefined) => [
  'timeout',
  seconds(ttlMs),
  'xclip',
  '-selection',
  'clipboard',
  '-loops',
  String(limits.pastes),
  // In the foreground, so `timeout` ends the process that holds the selection.
  '-quiet',
];
const read = ['xclip', '-selection', 'clipboard', '-o'];

export const xClipboard = ({
  shell,
  clock,
}: {
  readonly shell: Pick<Shell, 'start' | 'run'>;
  readonly clock: Pick<Clock, 'sleep'>;
}): Clipboard => ({
  put: async (value, ttlMs) => {
    // Detached, so it outlives the script's process, which ends at once.
    const server = shell.start(serve(ttlMs), { stdin: value, detached: true });
    const early = await Promise.race([
      server.exited,
      clock.sleep(settleMs).then(() => undefined),
    ]);
    if (early !== undefined && early !== 0)
      throw new Error(
        `couldn't put it on the clipboard: xclip exited ${early} (is xclip installed, and DISPLAY set?)`
      );
  },
  take: async () => {
    const ran = await shell.run(read, { timeoutMs: limits.readTimeoutMs });
    if (ran.code !== 0 || ran.stdout === '')
      throw new Error('the clipboard is empty, or holds no text');
    return ran.stdout;
  },
});
