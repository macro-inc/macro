/**
 * The conflict alarm. A pull that can't rebase the agent's commits onto the
 * remote's main is aborted, and the owner hears about it once, until a pull
 * goes through again. Nothing is lost meanwhile: commits stay local, and every
 * commit tries the pull again.
 */
import type { Repository } from './repository.ts';

export const conflictLine = (sha: string): string =>
  `My commits on main conflict with the remote's main at ${sha.slice(0, 12)}, so I stopped pulling it with --rebase and aborted. My commits stay local and unpushed, and every commit tries again until the conflict is settled.`;

/** Records a conflict on the remote's `sha`, telling the owner if they haven't been told since the last good pull. */
export const conflicted = async (
  repository: Pick<Repository, 'marker' | 'dm'>,
  sha: string
): Promise<'alarmed' | 'already'> => {
  if ((await repository.marker.read()) !== undefined) return 'already';
  // The marker first, so a DM that fails isn't an alarm on every commit.
  await repository.marker.write(sha);
  await repository.dm(conflictLine(sha));
  return 'alarmed';
};

/** A pull went through: whatever conflicted is settled. */
export const settled = async ({
  marker,
}: Pick<Repository, 'marker'>): Promise<void> => {
  if ((await marker.read()) !== undefined) await marker.clear();
};
