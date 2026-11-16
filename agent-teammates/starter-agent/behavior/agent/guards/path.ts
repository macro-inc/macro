/**
 * Posix paths as text, for guards: they are pure, so they can't ask the disk
 * or `node:path`, and only need to know where a command points.
 */
const separator = "/";
/** The directory a relative path starts from, and the one above it. */
export const here = ".";
const above = "..";

const withoutTrailing = (path: string): string =>
	path.replace(/(?<=.)\/+$/, "");

/** The last part of a path: the program's name of `/usr/bin/git`. */
export const basename = (path: string): string => {
	const trimmed = path.replace(/\/+$/, "");
	return trimmed.slice(trimmed.lastIndexOf(separator) + 1);
};

/** The path without its last part. */
export const dirname = (path: string): string => {
	const trimmed = withoutTrailing(path);
	const at = trimmed.lastIndexOf(separator);
	if (at < 0) return here;
	if (at === 0) return separator;
	return withoutTrailing(trimmed.slice(0, at));
};

/**
 * The parts joined, each relative to the one before, with `.` and `..`
 * worked out. An absolute part starts over. Unlike node's, a path that is
 * relative all the way stays relative: there is no working directory to ask.
 */
export const resolve = (...parts: readonly string[]): string => {
	const start = parts.findLastIndex((part) => part.startsWith(separator));
	const absolute = start >= 0;
	const kept: string[] = [];
	for (const segment of parts
		.slice(absolute ? start : 0)
		.flatMap((part) => part.split(separator))) {
		if (segment === "" || segment === here) continue;
		// Above the root is the root; above a relative start is still above it.
		if (segment !== above) kept.push(segment);
		else if (kept.length > 0 && kept.at(-1) !== above) kept.pop();
		else if (!absolute) kept.push(above);
	}
	const joined = kept.join(separator);
	if (absolute) return `${separator}${joined}`;
	return joined === "" ? here : joined;
};

/** Is the path this directory, or inside it? */
export const within = (path: string, directory: string): boolean =>
	path === directory ||
	path.startsWith(
		directory.endsWith(separator) ? directory : `${directory}${separator}`,
	);

/** The path's parts, without the empty ones. */
export const segments = (path: string): readonly string[] =>
	path.split(separator).filter((segment) => segment !== "");
