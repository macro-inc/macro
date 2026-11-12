/**
 * The agent's own repository, as the code that commits and lands sees it: git
 * run in the live checkout as the agent, and the lock that makes one of them
 * run at a time.
 *
 * The remote is the agent's repository in Macro, which its owner can push to
 * too. Every commit on main pulls it with --rebase before pushing, so the
 * owner's edits reach the live checkout and the history stays linear. Code
 * the owner pushes takes effect at the next restart, like a landing's.
 */
import type { Clock } from '@macro-inc/muppet/utilities/time';
import type { Ran } from '../../context/shell.ts';

/** Runs git in the repository, as the agent. */
export type Git = (
  args: readonly string[],
  options?: { readonly cwd?: string }
) => Promise<Ran>;

/** The remote SHA a pull last conflicted on, once the owner has been told. Cleared when a pull goes through. */
export type Marker = {
  readonly read: () => Promise<string | undefined>;
  readonly write: (sha: string) => Promise<void>;
  readonly clear: () => Promise<void>;
};

export type Held = { readonly release: () => void };

export type Repository = {
  readonly git: Git;
  readonly remote: string;
  readonly main: string;
  /** Whether there is a remote to pull from and push to. Without one, everything stays local and nothing alarms. */
  readonly hasRemote: () => Promise<boolean>;
  /** One line to the owner. */
  readonly dm: (text: string) => Promise<void>;
  readonly marker: Marker;
  /** Takes the git lock, waiting up to `waitMs`. Undefined if it stayed busy. */
  readonly hold: (waitMs: number) => Promise<Held | undefined>;
  readonly clock: Pick<Clock, 'now' | 'sleep'>;
  readonly log: (line: string) => Promise<void>;
};

/** The remote's main as the last pull or push saw it. */
export const upstreamRef = ({
  remote,
  main,
}: Pick<Repository, 'remote' | 'main'>): string =>
  `refs/remotes/${remote}/${main}`;

export const branchRef = (branch: string): string => `refs/heads/${branch}`;

/** `owner/name` from a GitHub remote's URL, or undefined if it isn't one. */
export const githubRepo = (url: string): string | undefined =>
  /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?\s*$/.exec(url)?.[1];
