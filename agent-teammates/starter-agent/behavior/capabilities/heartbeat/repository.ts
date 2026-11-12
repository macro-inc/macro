/**
 * The agent's own repository, as the code that commits, lands and guards it
 * sees it: git run in the live checkout as the agent, the remote's main read
 * through the API, and the lock that makes one of them run at a time.
 *
 * Code only flows out. This code runs unsandboxed with the agent's
 * credentials, and anyone who can push to the remote could otherwise put
 * code in it, so the live checkout is the source of truth. Nothing here
 * pulls, fetches or merges from the remote, and `refs/remotes/<remote>/<main>`
 * is the local record of what the agent last pushed, not the remote's state.
 */
import type { Clock } from "@muppet/lib/utilities/time";
import type { Ran } from "../../context/shell.ts";

/** Runs git in the repository, as the agent. */
export type Git = (
	args: readonly string[],
	options?: { readonly cwd?: string },
) => Promise<Ran>;

/** The remote's main: its SHA and who it says wrote it. Never its content. */
export type RemoteMain = { readonly sha: string; readonly author: string };

/** The remote SHA already alarmed on. While there is one, commits stay local: pushing can only be rejected. */
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
	/** Whether there is anywhere to push, and the means to. Without both, everything stays local and nothing alarms. */
	readonly hasRemote: () => Promise<boolean>;
	/** The remote's main, from the API, or undefined if it can't be read. */
	readonly remoteMain: () => Promise<RemoteMain | undefined>;
	/** One line to the owner. */
	readonly dm: (text: string) => Promise<void>;
	readonly marker: Marker;
	/** Takes the git lock, waiting up to `waitMs`. Undefined if it stayed busy. */
	readonly hold: (waitMs: number) => Promise<Held | undefined>;
	readonly clock: Pick<Clock, "now" | "sleep">;
	readonly log: (line: string) => Promise<void>;
	/** How many times a SHA behind what was pushed is read again, and how far apart. */
	readonly staleReads: number;
	readonly rereadMs: number;
};

/** The ref that records what the agent last pushed. */
export const pushedRef = ({
	remote,
	main,
}: Pick<Repository, "remote" | "main">): string =>
	`refs/remotes/${remote}/${main}`;

export const branchRef = (branch: string): string => `refs/heads/${branch}`;

/** `owner/name` from a GitHub remote's URL, or undefined if it isn't one. */
export const githubRepo = (url: string): string | undefined =>
	/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?\s*$/.exec(url)?.[1];
