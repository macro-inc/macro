/**
 * The snapshot the tick watches: the state of the agent's own repository,
 * and the sections other areas hand the heartbeat. Nothing in it changes on
 * its own, so a change in it means something happened, and an empty one
 * means there is nothing to wake for.
 */
import { unreadable } from "./guard.ts";
import type { Misplaced } from "./state.ts";

/** What is wrong with the agent's repository, if anything. */
export type RepositoryState = {
	/** The remote SHA the owner was alarmed on, `unknown` for a rejected push nobody could name, or undefined. */
	readonly alarm: string | undefined;
	/** Files git tracks that their bucket says it shouldn't. */
	readonly misplaced: Misplaced;
};

/** Where the snapshot's facts come from. */
export type Sources = {
	readonly repository: () => Promise<RepositoryState>;
	/** Sections other areas add. Each is its own text, or empty. */
	readonly sections: () => Promise<readonly string[]>;
};

export const repositoryHeading = "## Your repository";

/** A long list is cut, so one mistake doesn't fill the prompt. */
const shown = 20;

const listed = (paths: readonly string[]): string =>
	paths.length <= shown
		? paths.join(", ")
		: `${paths.slice(0, shown).join(", ")} and ${paths.length - shown} more`;

/** The repository's section: empty when nothing is wrong. */
export const repositorySection = ({
	alarm,
	misplaced: { local, stray },
}: RepositoryState): string => {
	const lines = [
		...(alarm === undefined
			? []
			: [
					alarm === unreadable
						? "- A push to the remote's main was rejected: someone else pushed. Your owner has been told. Nothing is pushed until the remote is back at what you last pushed."
						: `- The remote's main moved without you, to ${alarm.slice(0, 12)}. Your owner has been told. Nothing is pushed until the remote is back at what you last pushed.`,
				]),
		...(local.length === 0
			? []
			: [
					`- Tracked by git, in a bucket that is never committed: ${listed(local)}`,
				]),
		...(stray.length === 0
			? []
			: [
					`- Tracked by git, under the state directory but in no bucket: ${listed(stray)}`,
				]),
	];
	return lines.length === 0 ? "" : [repositoryHeading, ...lines].join("\n");
};

export const snapshot = async (sources: Sources): Promise<string> =>
	[repositorySection(await sources.repository()), ...(await sources.sections())]
		.map((section) => section.trimEnd())
		.filter((section) => section.trim() !== "")
		.join("\n\n");
