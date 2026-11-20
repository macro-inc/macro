import { expect, test } from "bun:test";
import { memoryDisk, join } from "../../../context/test/fakes.ts";
import { batches } from "../../../context/stream.ts";
import type { Queued } from "../entry.ts";
import { history } from "../history.ts";
import { typing } from "../typing.ts";

const queued = (id: string, channel_id = "c1"): Queued => ({
	id,
	root: id,
	thread: null,
	dm: true,
	from: "Ada",
	sender_id: "macro|owner@example.com",
	at: "2026-11-09T15:00:00Z",
	text: id,
	channel_id,
	channel: "Ada",
	mentioned: false,
	p: { addressed: 1 },
});

test("a conversation yields one batch at a time; others don't wait on it", async () => {
	const waiting = batches<string>();
	const reader = waiting.stream[Symbol.asyncIterator]();
	waiting.push("a", "a1");
	waiting.push("a", "a2");
	expect((await reader.next()).value).toEqual({
		key: "a",
		items: ["a1", "a2"],
	});
	// "a" is busy: what arrives for it waits, while "b" goes through.
	waiting.push("a", "a3");
	waiting.push("b", "b1");
	expect((await reader.next()).value).toEqual({ key: "b", items: ["b1"] });
	const next = reader.next();
	waiting.release("a");
	expect((await next).value).toEqual({ key: "a", items: ["a3"] });
});

test("waiting messages survive a restart until they are answered", async () => {
	const disk = memoryDisk();
	const make = () =>
		history({ directory: "private/history", queue: "run/queue", join, disk });
	await make().wait(queued("m1"));
	await make().wait(queued("m2"));
	await make().wait(queued("m3", "c2"));
	expect((await make().waiting()).map(({ id }) => id)).toEqual([
		"m1",
		"m2",
		"m3",
	]);
	await make().answered("c1", ["m1"]);
	expect((await make().waiting()).map(({ id }) => id)).toEqual(["m2", "m3"]);
	await make().answered("c1", ["m2"]);
	expect(await disk.exists("run/queue/c1.jsonl")).toBe(false);
});

test("history keeps what was recorded, and gives back the latest", async () => {
	const disk = memoryDisk();
	const kept = history({
		directory: "private/history",
		queue: "run/queue",
		join,
		disk,
	});
	for (const id of ["m1", "m2", "m3"]) await kept.record("c1", queued(id));
	expect((await kept.recent("c1", 2)).map(({ id }) => id)).toEqual([
		"m2",
		"m3",
	]);
	expect(await kept.recent("nowhere", 2)).toEqual([]);
});

test("typing stops once, with one stop, when the agent answers", async () => {
	const sent: string[] = [];
	const indicator = typing({
		send: async (channelId, action, root) => {
			sent.push(`${channelId}:${action}:${root ?? ""}`);
		},
		every: 60_000,
		most: 60_000,
	});
	indicator.start("c1", "root1");
	await indicator.stop("c1");
	await indicator.stop("c1");
	expect(sent).toEqual(["c1:start:root1", "c1:stop:root1"]);
});
