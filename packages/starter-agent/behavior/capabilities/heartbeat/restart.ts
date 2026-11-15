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
 * started. Returns the SHA.
 */
export const markHealthy = async ({
  git,
  disk,
  file,
}: {
  readonly git: (args: readonly string[]) => ReturnType<Git>;
  readonly disk: Pick<Disk, 'write'>;
  readonly file: string;
}): Promise<string> => {
  const head = await git(['rev-parse', '--verify', 'HEAD']);
  const sha = head.stdout.trim();
  if (head.code !== 0 || sha === '')
    throw new Error(
      `can't read HEAD to mark this boot healthy: ${head.stderr.trim().slice(0, 300)}`
    );
  await disk.write(file, `${sha}\n`);
  return sha;
};
