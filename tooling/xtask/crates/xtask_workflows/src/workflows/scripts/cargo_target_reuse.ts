// Lets cargo reuse the `target` directory the Generated Code Check keeps on its
// cache volume. Cargo counts a workspace crate as built when none of its
// sources is newer than its last build, and a checkout stamps every file with
// the current time, so without this every workspace crate rebuilds.
//
// The volume keeps, next to `target`, the time each tracked path's current
// contents were first seen (`RECORD`). A path whose mode and object match the
// record keeps that time; a changed or added path, and every directory above a
// change (its tree object changes), gets the current time. A build made while
// the contents were what they are now is newer than that time and stays fresh.
// A build of other contents is older than it: units only an earlier, different
// build left behind (other features, other dependencies) rebuild too.
//
// Some changes cargo can't see:
// - sqlx reads `.sqlx` query data without telling rustc. A new query's data
//   comes with the query's new source, so only changed data dates every path
//   now and rebuilds every workspace crate. Removed data that a query still
//   needs fails Rust CI's fresh build.
// - rustc lists the file a symlink pointed to when it built, so a symlink that
//   changed, appeared or went away dates the files it pointed to, before and
//   after, now. A link is resolved by its text alone: one through another
//   symlinked directory, or out of the repository, dates nothing.
// Migrations need nothing: `sqlx::migrate!` includes each file and
// `macro_db_migrator`'s build script watches the directory.
//
// Units dated after now (another clock, or anything else writing `target`)
// would look fresh against every change, so `target` starts over then.
//
// It runs on a fresh checkout: it dates the index, not the work tree.

import { execFileSync } from "node:child_process";
import {
	existsSync,
	lutimesSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	statfsSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";

export const TARGET = "target";
export const RECORD = `${TARGET}/.macro-source-times`;
// Dependency upgrades leave old artifacts in `target`; start over before the
// volume runs short.
const MIN_FREE_BYTES = 20 * 1024 ** 3;
const SYMLINK = "120000 ";

/** Path to `<mode> <type> <object>`. */
export type Tree = Map<string, string>;
/** Path to its signature and the time (seconds) those contents were first seen. */
export type SourceTimes = Map<string, { signature: string; time: number }>;

export type Plan = {
	/** What to date each tracked path, and to keep for the next run. */
	record: SourceTimes;
	changed: number;
	/** Why every path is dated now, when it is. */
	rebuildAll?: string;
};

/** `git ls-tree -r -t -z` output. */
export function parseTree(output: string): Tree {
	const tree: Tree = new Map();
	for (const entry of output.split("\0")) {
		const tab = entry.indexOf("\t");
		if (tab > 0) tree.set(entry.slice(tab + 1), entry.slice(0, tab));
	}
	return tree;
}

export function parseRecord(text: string): SourceTimes {
	const record: SourceTimes = new Map();
	for (const entry of text.split("\0")) {
		const tab = entry.indexOf("\t");
		const space = entry.indexOf(" ");
		if (tab < 0 || space < 0 || space > tab) continue;
		record.set(entry.slice(tab + 1), {
			time: Number(entry.slice(0, space)),
			signature: entry.slice(space + 1, tab),
		});
	}
	return record;
}

export function formatRecord(record: SourceTimes): string {
	return [...record]
		.map(([path, { time, signature }]) => `${time} ${signature}\t${path}\0`)
		.join("");
}

/** A symlink's signature carries what it points to, which the next run needs. */
function signatureOf(mode: string, link: string | undefined): string {
	return link === undefined ? mode : `${mode} ${JSON.stringify(link)}`;
}

/** The repository path a symlink at `path` resolves to, when it stays inside. */
function linkTarget(path: string, signature: string): string | undefined {
	if (!signature.startsWith(SYMLINK)) return;
	const quoted = signature.indexOf(' "');
	if (quoted < 0) return;
	const target = posix.normalize(
		posix.join(posix.dirname(path), JSON.parse(signature.slice(quoted + 1))),
	);
	return target.startsWith("../") || posix.isAbsolute(target)
		? undefined
		: target;
}

/** `links` holds what each tracked symlink in `tree` points to. */
export function plan(
	previous: SourceTimes | undefined,
	tree: Tree,
	links: Map<string, string>,
	now: number,
): Plan {
	const record: SourceTimes = new Map();
	const linkedTo = new Set<string>();
	const linked = (path: string, signature: string) => {
		const target = linkTarget(path, signature);
		if (target !== undefined) linkedTo.add(target);
	};
	let changed = 0;
	let rebuildAll = previous ? undefined : "no record of earlier builds";
	for (const [path, mode] of tree) {
		const signature = signatureOf(mode, links.get(path));
		const before = previous?.get(path);
		if (before?.signature === signature) {
			record.set(path, before);
			continue;
		}
		changed++;
		record.set(path, { signature, time: now });
		linked(path, signature);
		if (before) linked(path, before.signature);
		if (before && /(^|\/)\.sqlx\//.test(path)) {
			rebuildAll ??= `${path} (sqlx query data) changed`;
		}
	}
	for (const [path, { signature }] of previous ?? []) {
		if (tree.has(path)) continue;
		changed++;
		linked(path, signature);
	}
	const targets = [...linkedTo];
	for (const [path, { signature, time }] of record) {
		const dated =
			rebuildAll !== undefined ||
			targets.some(
				(target) => path === target || path.startsWith(`${target}/`),
			);
		if (dated && time !== now) record.set(path, { signature, time: now });
	}
	return { record, changed, rebuildAll };
}

function git(...args: string[]): string {
	return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 ** 3 });
}

/**
 * The newest time cargo compares sources against: a unit's fingerprint files
 * and, for a build script's `rerun-if-changed`, its `output`.
 */
function newestUnit(): number {
	let newest = 0;
	const consider = (path: string) => {
		if (existsSync(path)) {
			newest = Math.max(newest, statSync(path).mtimeMs / 1000);
		}
	};
	const children = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);
	for (const profile of readdirSync(TARGET, { withFileTypes: true })) {
		if (!profile.isDirectory()) continue;
		const fingerprints = join(TARGET, profile.name, ".fingerprint");
		for (const unit of children(fingerprints)) {
			for (const file of children(join(fingerprints, unit))) {
				consider(join(fingerprints, unit, file));
			}
		}
		const builds = join(TARGET, profile.name, "build");
		for (const unit of children(builds)) consider(join(builds, unit, "output"));
	}
	return newest;
}

function emptyTarget(why: string) {
	console.log(`Emptying ${TARGET}: ${why}`);
	for (const entry of readdirSync(TARGET))
		rmSync(join(TARGET, entry), { recursive: true, force: true });
}

export async function main() {
	const now = Date.now() / 1000;
	mkdirSync(TARGET, { recursive: true });
	const { bavail, bsize } = statfsSync(TARGET);
	console.log(
		`${Math.round((bavail * bsize) / 1024 ** 3)} GB free on the cache volume`,
	);
	if (bavail * bsize < MIN_FREE_BYTES) {
		emptyTarget("the cache volume is running out of space");
	} else if (newestUnit() > now) {
		emptyTarget("a unit in it is dated after now");
	}

	const tree = parseTree(
		git("ls-tree", "-r", "-t", "-z", git("write-tree").trim()),
	);
	const links = new Map<string, string>();
	for (const [path, mode] of tree) {
		if (mode.startsWith(SYMLINK) && existsSync(dirname(path))) {
			links.set(path, readlinkSync(path));
		}
	}
	const previous = existsSync(RECORD)
		? parseRecord(readFileSync(RECORD, "utf8"))
		: undefined;
	const { record, changed, rebuildAll } = plan(previous, tree, links, now);
	for (const [path, { time }] of record) {
		try {
			lutimesSync(path, time, time);
		} catch (error) {
			// Paths outside a sparse checkout are not in the work tree.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	writeFileSync(RECORD, formatRecord(record));
	console.log(
		rebuildAll
			? `Every workspace crate rebuilds: ${rebuildAll}`
			: `Reusing ${TARGET}: ${changed} paths differ from the last run`,
	);
}
