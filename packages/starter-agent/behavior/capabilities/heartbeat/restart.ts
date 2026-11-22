/**
 * The agent's side of its supervisor: how it asks to be restarted onto code
 * that landed, and how it says a boot was healthy. The supervisor (the image's
 * launcher) restarts it on the marker or the exit, and rolls the repository
 * back to the last good HEAD when boots keep failing.
 */
import { type Clock, isoText } from '@macro-inc/muppet/utilities/time';
import type { Disk } from '../../context/disk.ts';
import type { Git } from './repository.ts';

/** The exit code that means "restart me": not a failure, so the supervisor doesn't count it towards a rollback. */
export const restartExitCode = 75;

/** Asks for a restart: touches the restart marker, then exits with `restartExitCode`. */
export const restarter =
  ({
    disk,
    file,
    clock,
    exit,
  }: {
    readonly disk: Pick<Disk, 'write'>;
    /** The supervisor's restart marker, MUPPET_RESTART_FILE. */
    readonly file: string;
    readonly clock: Pick<Clock, 'now'>;
    readonly exit: (code: number) => void;
  }) =>
  async (): Promise<void> => {
    await disk.write(file, `${isoText(clock.now())}\n`);
    exit(restartExitCode);
  };

/**
 * Records that this boot was healthy: the HEAD it is running, as one line in
 * `file` (MUPPET_LAST_GOOD_FILE), written atomically. Call it once the
 * behavior is built, its credentials read, presence open and its sources
 * started; it waits until chat is `listening` too (its stream open and a
 * round trip to Macro worked). At `deadline` it throws only when Macro has
 * answered (`reached`) and chat still can't hear, the code's fault, so the
 * launcher counts a failed boot. While Macro is unreachable (the agent's
 * machine is offline) it waits, unhealthy but up, and gives the stream a new
 * deadline once Macro answers. Returns the SHA.
 */
const heard = 'heard';
const late = 'late';

export const markHealthy = async ({
  git,
  disk,
  file,
  listening,
  deadline,
  reached,
  reachable,
}: {
  readonly git: (args: readonly string[]) => ReturnType<Git>;
  readonly disk: Pick<Disk, 'write'>;
  readonly file: string;
  readonly listening: () => Promise<void>;
  readonly deadline: () => Promise<void>;
  /** Macro has answered a request in this process. */
  readonly reached: () => boolean;
  /** Resolves once Macro has answered a request. */
  readonly reachable: () => Promise<void>;
}): Promise<string> => {
  for (;;) {
    const outcome = await Promise.race([
      listening().then(() => heard),
      deadline().then(() => late),
    ]);
    if (outcome === heard) break;
    if (reached())
      throw new Error(
        "not listening: Macro answers, but chat's event stream didn't open in time"
      );
    // Offline: wait for Macro, then give the stream its deadline again.
    if (
      (await Promise.race([
        listening().then(() => heard),
        reachable().then(() => late),
      ])) === heard
    )
      break;
  }
  const head = await git(['rev-parse', '--verify', 'HEAD']);
  const sha = head.stdout.trim();
  if (head.code !== 0 || sha === '')
    throw new Error(
      `can't read HEAD to mark this boot healthy: ${head.stderr.trim().slice(0, 300)}`
    );
  await disk.write(file, `${sha}\n`);
  return sha;
};
