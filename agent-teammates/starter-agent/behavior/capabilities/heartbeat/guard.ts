/**
 * The tamper alarm. The live checkout is the source of truth: if the
 * remote's main isn't what the agent last pushed, someone else pushed. The
 * SHA and author are read from the API, one line goes to the owner, and
 * nothing comes in.
 */
import { pushedRef, type RemoteMain, type Repository } from "./repository.ts";

export type GuardResult =
	/** The remote is at what the agent last pushed. */
	| "same"
	/** It moved, and the owner was just told. */
	| "alarmed"
	/** It moved, and the owner was told before. */
	| "already"
	/** The remote can't be read, or nothing was ever pushed. */
	| "unknown"
	/** The repository has no remote: nothing to compare. */
	| "none";

/** What the alarm marker holds when a push was rejected and the remote couldn't say who pushed. */
export const unreadable = "unknown";

/** The author is whatever the pusher typed, and it goes into a DM: no markup, one short line. */
const plain = (text: string): string =>
	text
		.replace(/[<>`\s]+/g, " ")
		.trim()
		.slice(0, 60);

export const alarmLine = ({ sha, author }: RemoteMain): string =>
	`My repository's main on GitHub moved without me: ${sha.slice(0, 12)} by ${plain(author) || "unknown"}. Not pulled; I keep committing locally and stop pushing.`;

export const rejectedLine =
	"GitHub rejected my push to my repository's main, so someone else pushed, and I can't read who. Not pulled; I keep committing locally and stop pushing.";

/**
 * GitHub's commit list can lag a push by seconds, so a SHA behind what was
 * pushed is read again, or a landing would alarm on its own push. Only that: nothing is ever fetched, so someone else's commit
 * isn't here and can't pass as an ancestor. Whatever this returns,
 * `checkMain` still judges: behind for every read is a rewind, and that's
 * tampering too.
 */
const readMain = async (
	repository: Repository,
	pushed: string,
	marker: string | undefined,
): Promise<RemoteMain | undefined> => {
	for (let read = 1; ; read += 1) {
		const remote = await repository.remoteMain().catch(() => undefined);
		if (
			remote === undefined ||
			remote.sha === pushed ||
			remote.sha === marker ||
			read >= repository.staleReads
		)
			return remote;
		const behind = await repository.git([
			"merge-base",
			"--is-ancestor",
			remote.sha,
			pushed,
		]);
		if (behind.code !== 0) return remote;
		await repository.clock.sleep(repository.rereadMs);
	}
};

/**
 * Compares the remote's main with what the agent last pushed. Call it with the git
 * lock held, so its own push can't look like someone else's. `rejected`
 * means a push was just refused, which is enough to know even when GitHub
 * can't say who.
 */
export const checkMain = async (
	repository: Repository,
	{ rejected = false }: { readonly rejected?: boolean } = {},
): Promise<GuardResult> => {
	if (!(await repository.hasRemote())) return "none";
	const pushed = (
		await repository.git(["rev-parse", "--verify", "-q", pushedRef(repository)])
	).stdout.trim();
	const marker = await repository.marker.read();
	const remote = await readMain(repository, pushed, marker);
	if (remote === undefined || pushed === "") {
		if (!rejected || marker !== undefined) return "unknown";
		await repository.marker.write(unreadable);
		await repository.dm(rejectedLine);
		return "alarmed";
	}
	if (remote.sha === pushed) {
		// Back at what was pushed: pushes resume.
		await repository.marker.clear();
		return "same";
	}
	if (marker === remote.sha) return "already";
	// The marker first, so a DM that fails isn't an alarm on every tick.
	await repository.marker.write(remote.sha);
	await repository.dm(alarmLine(remote));
	return "alarmed";
};

/** The heartbeat's check: skips this tick if the lock is busy, since a commit or a landing is pushing right now. */
export const guardTick = async (
	repository: Repository,
	waitMs: number,
): Promise<GuardResult | "busy"> => {
	const held = await repository.hold(waitMs);
	if (held === undefined) return "busy";
	try {
		return await checkMain(repository);
	} finally {
		held.release();
	}
};
