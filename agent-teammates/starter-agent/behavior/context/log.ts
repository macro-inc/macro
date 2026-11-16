import { isoText } from "@muppet/lib/utilities/time";
import type { Clock } from "@muppet/lib/utilities/time";
import { type Disk, jsonLine } from "./disk.ts";

/**
 * Logs you can read back: JSONL with an instant on every line, one file per
 * stream, and one index with a line per run.
 */
export type Log = {
	/** Appends `entry`, with the time, to the stream's file. Never throws. */
	readonly event: (stream: string, entry: object) => Promise<void>;
	/** The stream's file, for whoever reads it back. */
	readonly file: (stream: string) => string;
};

export const log = ({
	directory,
	join,
	disk,
	clock,
}: {
	readonly directory: string;
	readonly join: (...parts: readonly string[]) => string;
	readonly disk: Pick<Disk, "append">;
	readonly clock: Pick<Clock, "now">;
}): Log => {
	const file = (stream: string) => join(directory, `${stream}.jsonl`);
	return {
		file,
		event: (stream, entry) =>
			disk
				.append(file(stream), jsonLine({ at: isoText(clock.now()), ...entry }))
				.catch(() => undefined),
	};
};
