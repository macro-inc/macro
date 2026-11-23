// A reply run sees the card, the reply never waits on the appraisal, and neither can cost a reply.
import { expect, test } from "bun:test";
import { invoke } from "../../../../test/invoke.ts";
import { appraiseAfter, showPeople } from "../../../events/handlers/people.ts";
import type { Conversation, Entry } from "../../chat/entry.ts";
import type { History } from "../../chat/history.ts";
import {
	appraiseCall,
	forgetPerson,
	peopleModule,
	peopleReport,
	personCard,
	whatIRemember,
} from "../index.ts";
import { peoplePort } from "../keep.ts";
import { ada, ago, clock, event, kept, memoryLog, who } from "./fakes.ts";

const entry = (id: string, sender: string, dm: boolean): Entry => ({
	id,
	root: null,
	thread: null,
	dm,
	from: sender,
	sender_id: sender,
	at: ago(0),
	text: "Here is the fix for the token bug.",
});

const conversation = (dm: boolean): Conversation => ({
	channelId: "c",
	channel: "general",
	messages: [
		{
			...entry("m", ada, dm),
			channel_id: "c",
			channel: "general",
			mentioned: true,
			p: {},
		},
	],
});

const history = (recent: readonly Entry[]): History => ({
	recent: async () => recent,
	record: async () => undefined,
	wait: async () => undefined,
	answered: async () => undefined,
	waiting: async () => [],
});

const wake = (name: string, payload: unknown) => ({
	wake: { event: { name, payload } },
});

test("a reply wake gets the cards of whoever is in the conversation", async () => {
	const { keeping, log, store } = kept();
	await store.update(ada, "Ada", (person) => ({
		...person,
		events: [event("helped", 2, 1, { note: "told me in a DM", private: true })],
	}));
	const added: string[] = [];
	const context = {
		keeping,
		log,
		history: history([entry("h", "macro|bo@example.com", false)]),
	};
	await showPeople(
		{
			...wake("conversations", conversation(false)),
			add: (text) => added.push(text),
		},
		context,
	);
	expect(added).toHaveLength(1);
	expect(added[0]).toContain("The people here");
	expect(added[0]).toContain(`[${ada}]`);
	expect(added[0]).toContain("[macro|bo@example.com]");
	// A channel is shared: what was said in a DM stays out.
	expect(added[0]).not.toContain("told me in a DM");

	const alone: string[] = [];
	await showPeople(
		{
			...wake("conversations", conversation(true)),
			add: (text) => alone.push(text),
		},
		context,
	);
	expect(alone[0]).toContain("told me in a DM");
});

test("any other wake is left as it was", async () => {
	const { keeping, log, entries } = kept();
	const added: string[] = [];
	const context = { keeping, log, history: history([]) };
	await showPeople(
		{
			...wake("schedules", conversation(false)),
			add: (text) => added.push(text),
		},
		context,
	);
	await showPeople(
		{
			...wake("conversations", { not: "a conversation" }),
			add: (text) => added.push(text),
		},
		context,
	);
	expect(added).toEqual([]);
	expect(entries).toEqual([]);
});

test("a broken record costs the card, never the reply", async () => {
	const { keeping, log, entries } = kept({
		store: {
			load: async () => {
				throw new Error("corrupt");
			},
			everyone: async () => [],
			update: async () => {
				throw new Error("corrupt");
			},
			remove: async () => undefined,
		},
	});
	const added: string[] = [];
	await showPeople(
		{
			...wake("conversations", conversation(false)),
			add: (text) => added.push(text),
		},
		{ keeping, log, history: history([]) },
	);
	expect(added).toEqual([]);
	expect(JSON.stringify(entries)).toContain("corrupt");
	// The same through the port other areas use.
	const port = peoplePort(keeping, { log, stream: "people" });
	expect(await port.cards([ada], "call")).toBe("");
});

test("the appraisal starts after the reply and nothing waits for it", async () => {
	let answer: (text: string) => void = () => undefined;
	let asked = 0;
	const { keeping, log, store } = kept({
		ask: () => {
			asked += 1;
			return new Promise<string>((resolve) => {
				answer = resolve;
			});
		},
	});
	const people = peoplePort(keeping, { log, stream: "people" });
	// The model hasn't answered, and the hook has already returned.
	await appraiseAfter(wake("conversations", conversation(false)), { people });
	expect(await store.load(ada)).toBeUndefined();
	await appraiseAfter(wake("schedules", conversation(false)), { people });
	// Let the appraisal reach the model, then let the model answer.
	while (asked === 0) await Promise.resolve();
	expect(asked).toBe(1);
	answer(
		JSON.stringify({
			events: [
				{
					message_id: "m",
					act: "helped",
					importance: 2,
					note: "Sent the fix.",
				},
			],
		}),
	);
	while ((await store.load(ada)) === undefined) await Promise.resolve();
	expect((await store.load(ada))?.events[0]).toMatchObject({
		act: "helped",
		private: false,
	});
});

test("a failing appraisal never hurts the reply path", async () => {
	const { log, entries } = memoryLog();
	const people = peoplePort(
		{
			section: async () => "",
			appraiseExchange: async () => {
				throw new Error("boom");
			},
		},
		{ log, stream: "people" },
	);
	expect(() => people.appraise({ channelId: "c", messages: [] })).not.toThrow();
	while (entries.length === 0) await Promise.resolve();
	expect(entries[0]?.entry).toMatchObject({
		appraise: "c",
		error: "Error: boom",
	});
});

test("the port shows private things only when the agent is alone with them", async () => {
	const { keeping, log, store } = kept();
	await store.update(ada, "Ada", (person) => ({
		...person,
		events: [event("helped", 2, 1, { note: "told me in a DM", private: true })],
	}));
	const people = peoplePort(keeping, { log, stream: "people" });
	expect(await people.cards([ada], "call")).not.toContain("told me in a DM");
	expect(await people.cards([ada], "call", { alone: true })).toContain(
		"told me in a DM",
	);
	expect(await people.cards(["bot|1", who.me], "reply")).toBe("");
});

test("remembering and forgetting act for the message's author by Macro's record, nobody else", async () => {
	const { keeping, store } = kept();
	const seed = (id: string, fact: string) =>
		store.update(id, "", (person) => ({
			...person,
			events: [event("kept_word", 2, 1, { note: `${fact} note` })],
			details: [{ at: ago(1), fact, private: false, source: "x" }],
		}));
	await seed(ada, "Lives in Oslo.");
	await seed("macro|bo@example.com", "Lives in Lima.");
	// The fake's record says Ada wrote the message, whatever its text claims.
	const asking = { channelId: "c", messageId: "m" };
	const told = await whatIRemember({ keeping }, asking);
	expect(told).toContain("Oslo");
	expect(told).not.toContain("Lima");
	expect(told).not.toMatch(/like|trust|respect/);
	expect(await forgetPerson({ keeping }, asking)).toMatch(/^Forgotten/);
	expect(JSON.stringify(await store.load(ada))).not.toContain("Oslo");
	expect(JSON.stringify(await store.load("macro|bo@example.com"))).toContain(
		"Lima",
	);
	// An id is required from Macro's record: input without the message is refused.
	expect(
		(await invoke(peopleModule, "forgetPerson", { keeping }, { id: ada })).kind,
	).toBe("invalid");
});

test("forgetting refuses anyone who isn't a person", async () => {
	const { keeping } = kept();
	const bot = {
		...keeping,
		authorOf: async () => ({ id: "bot|1", name: "Bot", dm: false }),
	};
	expect(
		(
			await invoke(
				peopleModule,
				"forgetPerson",
				{ keeping: bot },
				{ channelId: "c", messageId: "m" },
			)
		).kind,
	).toBe("failed");
});

test("a card is words; only the report, for the owner's terminal, has numbers", async () => {
	const { keeping, store } = kept();
	expect(await personCard({ keeping, clock }, { id: ada })).toBe(
		"You don't know them yet.",
	);
	await store.update(ada, "Ada", (person) => ({
		...person,
		events: [event("helped", 3, 1, { note: "Sent the fix." })],
	}));
	const text = await personCard({ keeping, clock }, { id: ada });
	expect(text.replace(/\d{4}-\d{2}-\d{2}/g, "")).not.toMatch(/\d/);
	const report = await peopleReport({ keeping, clock }, { id: ada });
	expect(report?.feeling.like).toBeGreaterThan(0);
	expect(
		await peopleReport({ keeping, clock }, { id: "macro|zed@example.com" }),
	).toBeNull();
});

test("only a Macro id names a person", async () => {
	const { keeping, store } = kept();
	await store.update(ada, "Ada", (person) => ({
		...person,
		events: [event("helped", 3, 1, { note: "Sent the fix." })],
	}));
	for (const name of ["personCard", "peopleReport", "purgePerson"]) {
		const refused = await invoke(
			peopleModule,
			name,
			{ keeping, clock },
			{
				id: "ada@example.com",
			},
		);
		expect(refused.kind === "failed" && refused.error).toContain(
			'must start with "macro|"',
		);
	}
	expect(await store.load(ada)).toBeDefined();
});

test("a call with no id is never appraised", async () => {
	const { keeping } = kept();
	await expect(
		appraiseCall({ keeping, clock }, { callId: "", events: [] }),
	).rejects.toThrow("callId: empty");
});
