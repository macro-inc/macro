import type { Files } from "@muppet/lib/core/state";
import type { z } from "zod";

/** The filesystem, injected. A superset of lib's `Files`. */
export type Disk = Files & {
	/** Adds to the end of the file, creating it and its directory if needed. */
	readonly append: (path: string, text: string) => Promise<void>;
	/** Removes a file or a directory and everything in it. Nothing happens if it isn't there. */
	readonly remove: (path: string) => Promise<void>;
	/** Renames a file, replacing what is at the new path. False if there was nothing to rename. */
	readonly rename: (from: string, to: string) => Promise<boolean>;
	/** The names in a directory, sorted, or none if it isn't there. */
	readonly list: (directory: string) => Promise<readonly string[]>;
	readonly exists: (path: string) => Promise<boolean>;
	/** When the file last changed, or undefined if it isn't there. */
	readonly modified: (path: string) => Promise<Temporal.Instant | undefined>;
	readonly makeDirectory: (path: string) => Promise<void>;
};

/** One JSON value per line. */
export const jsonLine = (value: unknown): string =>
	`${JSON.stringify(value)}\n`;

/** The lines of a JSONL text that parse as `schema`; the rest are dropped. */
export const parseLines = <Value>(
	schema: z.ZodType<Value>,
	text: string | undefined,
): readonly Value[] =>
	(text ?? "").split("\n").flatMap((line) => {
		if (line.trim() === "") return [];
		try {
			const parsed = schema.safeParse(JSON.parse(line));
			return parsed.success ? [parsed.data] : [];
		} catch {
			return [];
		}
	});

/** The file's JSON as `schema`, or undefined if it isn't there or doesn't fit. */
export const readJson = async <Value>(
	disk: Pick<Disk, "read">,
	path: string,
	schema: z.ZodType<Value>,
): Promise<Value | undefined> => {
	const text = await disk.read(path);
	if (text === undefined || text.trim() === "") return undefined;
	try {
		const parsed = schema.safeParse(JSON.parse(text));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};

export const writeJson = (
	disk: Pick<Disk, "write">,
	path: string,
	value: unknown,
): Promise<void> => disk.write(path, `${JSON.stringify(value, null, "\t")}\n`);

/** The last `count` lines of a text, without a trailing empty one. */
export const lastLines = (text: string, count: number): readonly string[] =>
	text
		.split("\n")
		.filter((line) => line !== "")
		.slice(-count);
