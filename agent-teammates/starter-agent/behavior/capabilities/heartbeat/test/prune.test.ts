import { expect, test } from "bun:test";
import { join, memoryDisk } from "../../../context/test/fakes.ts";
import {
	actions,
	type Entry,
	expired,
	prune,
	type Rule,
	type Tree,
	trimmed,
} from "../prune.ts";

const now = Temporal.Instant.from("2026-11-09T00:00:00Z");
const fresh = now.subtract({ hours: 1 });
const old = now.subtract({ hours: 40 * 24 });

/** A tree from `path -> when it changed`; a path ending in `/` is a directory. */
const treeOf = (things: Readonly<Record<string, Temporal.Instant>>): Tree => ({
	entries: async (directory) =>
		Object.entries(things).flatMap(([path, modified]): readonly Entry[] => {
			const isDirectory = path.endsWith("/");
			const clean = isDirectory ? path.slice(0, -1) : path;
			const cut = clean.lastIndexOf("/");
			return clean.slice(0, cut) === directory
				? [{ name: clean.slice(cut + 1), directory: isDirectory, modified }]
				: [];
		}),
});

test("expired is find -mtime +N (whole days)", () => {
	const start = Temporal.Instant.from("2026-01-01T00:00:00Z");
	expect(expired(start, start.add({ hours: 30 * 24, seconds: 5 }), 30)).toBe(
		false,
	);
	expect(expired(start, start.add({ hours: 31 * 24 }), 30)).toBe(true);
});

test("trim only past twice the cap, keeping the newest", () => {
	expect(trimmed("1\n2\n3\n4\n", 2)).toBeUndefined();
	expect(trimmed("1\n2\n3\n4\n5\n", 2)).toBe("4\n5\n");
});

test("a log directory: jsonl logs are trimmed, old per-run files go, and old things inside its folders go whole", async () => {
	const rule: Rule = {
		kind: "logs",
		directory: "log/agent",
		days: 30,
		lines: 1,
	};
	const tree = treeOf({
		"log/agent/listen.jsonl": old,
		"log/agent/old-run.log": old,
		"log/agent/new-run.log": fresh,
		"log/agent/calls/": old,
		"log/agent/calls/old-call/": old,
		"log/agent/calls/new-call/": fresh,
		"log/agent/calls/old-call/events.jsonl": old,
	});
	expect(await actions(rule, { tree, join, now })).toEqual([
		{ kind: "trim", path: "log/agent/listen.jsonl", lines: 1 },
		{ kind: "remove", path: "log/agent/old-run.log" },
		{ kind: "remove", path: "log/agent/calls/old-call" },
	]);
});

test("per-run files expire; histories and single files are trimmed, never removed", async () => {
	const tree = treeOf({
		"run/work/A.json": old,
		"run/work/B.json": fresh,
		"run/work/keep/": old,
		"private/chat/history/c.jsonl": old,
		"private/chat/history/notes.txt": old,
	});
	expect(
		await actions(
			{ kind: "expire", directory: "run/work", days: 30 },
			{ tree, join, now },
		),
	).toEqual([{ kind: "remove", path: "run/work/A.json" }]);
	expect(
		await actions(
			{ kind: "trim", directory: "private/chat/history", lines: 5 },
			{ tree, join, now },
		),
	).toEqual([{ kind: "trim", path: "private/chat/history/c.jsonl", lines: 5 }]);
	expect(
		await actions(
			{ kind: "trimFile", file: "private/mail/events.jsonl", lines: 9 },
			{ tree, join, now },
		),
	).toEqual([{ kind: "trim", path: "private/mail/events.jsonl", lines: 9 }]);
});

test("prune removes old run logs, trims logs and history, and a missing directory is nothing", async () => {
	const disk = memoryDisk({
		"log/agent/heartbeat.jsonl": "1\n2\n3\n",
		"log/agent/old-run.log": "x",
		"log/agent/new-run.log": "x",
		"private/chat/history/c.jsonl": "a\nb\nc\n",
		"private/chat/history/short.jsonl": "a\nb\n",
	});
	const tree = treeOf({
		"log/agent/heartbeat.jsonl": fresh,
		"log/agent/old-run.log": old,
		"log/agent/new-run.log": fresh,
		"private/chat/history/c.jsonl": fresh,
		"private/chat/history/short.jsonl": fresh,
	});
	const pruned = await prune({
		rules: [
			{ kind: "logs", directory: "log/agent", days: 30, lines: 1 },
			{ kind: "trim", directory: "private/chat/history", lines: 1 },
			{ kind: "expire", directory: "run/nothing", days: 30 },
			{ kind: "trimFile", file: "private/mail/events.jsonl", lines: 1 },
		],
		tree,
		disk,
		join,
		now,
	});
	expect(pruned).toEqual({ removed: 1, trimmed: 2 });
	expect([...disk.files]).toEqual([
		["log/agent/heartbeat.jsonl", "3\n"],
		["log/agent/new-run.log", "x"],
		["private/chat/history/c.jsonl", "c\n"],
		["private/chat/history/short.jsonl", "a\nb\n"],
	]);
});
