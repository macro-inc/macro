import { expect, test } from "bun:test";
import { memoryStore, scheduler } from "@muppet/lib/utilities/schedules";
import { invoke } from "../../../../test/invoke.ts";
import {
	ensureIntroduction,
	introduction,
} from "../../../events/handlers/identity.ts";
import { identityModule, readIdentity, writeIdentity } from "../index.ts";
import { introduce, known, unknown } from "../prompt.ts";

const now = Temporal.Instant.from("2026-01-05T10:00:00Z");
const clock = { now: () => now, sleep: async () => {} };

const fake = () => {
	const files = new Map<string, string>();
	const join = (...parts: readonly string[]) => parts.join("/");
	return {
		files,
		clock,
		join,
		state: { memory: (owner: string) => `/state/memory/${owner}` },
		disk: {
			read: async (path: string) => files.get(path),
			write: async (path: string, text: string) => {
				files.set(path, text);
			},
			exists: async (path: string) => files.has(path),
		},
	};
};

test("a new agent has no identity, and is told so, with the questions to ask", async () => {
	const context = fake();
	expect(await readIdentity(context)).toBeUndefined();
	expect(unknown).toContain("Who am I?");
	expect(unknown).toContain("What is my purpose?");
	expect(unknown).toContain("writeIdentity");
});

test("what it writes is what it reads back, whole, and what every wake is shown", async () => {
	const context = fake();
	await writeIdentity(context, {
		markdown: "  I am Pip. I keep Ada's calendar.\n\n",
	});
	expect(await readIdentity(context)).toBe("I am Pip. I keep Ada's calendar.");
	expect(known("I am Pip.")).toContain("I am Pip.");
	await writeIdentity(context, { markdown: "I am Pip, and I am blunt." });
	expect(await readIdentity(context)).toBe("I am Pip, and I am blunt.");
});

test("an empty identity is refused, and what was there stays", async () => {
	const context = fake();
	await writeIdentity(context, { markdown: "I am Pip." });
	const refused = await invoke(identityModule, "writeIdentity", context, {
		markdown: "  ",
	});
	expect(refused).toMatchObject({ kind: "failed" });
	expect(JSON.stringify(refused)).toContain("empty identity");
	expect(await readIdentity(context)).toBe("I am Pip.");
});

test("a new agent is woken once to introduce itself, and never again", async () => {
	const context = fake();
	const schedules = scheduler({ store: memoryStore(), clock, tz: "UTC" });
	await ensureIntroduction(context, schedules);
	expect(
		(await schedules.list()).map(({ name, schedule }) => [name, schedule.data]),
	).toEqual([[introduction, { wake: introduce }]]);
	await schedules.remove(introduction);
	await ensureIntroduction(context, schedules);
	expect(await schedules.list()).toEqual([]);
});

test("an agent that already knows who it is isn't asked to introduce itself", async () => {
	const context = fake();
	await writeIdentity(context, { markdown: "I am Pip." });
	const schedules = scheduler({ store: memoryStore(), clock, tz: "UTC" });
	await ensureIntroduction(context, schedules);
	expect(await schedules.list()).toEqual([]);
});
