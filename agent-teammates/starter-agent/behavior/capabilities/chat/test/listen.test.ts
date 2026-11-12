import { expect, test } from "bun:test";
import type { Entry, Incoming } from "../entry.ts";
import { inThread, isRelevant, judge, type Probabilities } from "../listen.ts";
import { screen } from "../screen.ts";

const me = "macro|agent@example.com";
const owner = "macro|owner@example.com";

const entry = (over: Partial<Entry> = {}): Entry => ({
	id: "m1",
	root: "m1",
	thread: null,
	dm: false,
	from: "Ada",
	sender_id: owner,
	at: "2026-11-09T15:00:00Z",
	text: "hello",
	...over,
});

const incoming = (over: Partial<Entry> = {}, more: Partial<Incoming> = {}) => ({
	channelId: "c1",
	channel: "general",
	entry: entry(over),
	mentions: [],
	...more,
});

const never = async (): Promise<Probabilities> => {
	throw new Error("the screen must not be asked");
};

const facts = (
	decide: (input: unknown) => Promise<Probabilities>,
	history: readonly Entry[] = [],
) => ({
	me,
	name: "Pip",
	history,
	screen,
	decide,
	failed: async () => undefined,
});

test("its own posts and bots are ignored", async () => {
	expect((await judge(incoming({ sender_id: me }), facts(never))).kind).toBe(
		"ignored",
	);
	expect(
		(await judge(incoming({ sender_id: "bot|x" }), facts(never))).kind,
	).toBe("ignored");
});

test("a DM always reaches the agent, without the screen", async () => {
	const verdict = await judge(incoming({ dm: true }), facts(never));
	expect(verdict).toEqual({
		kind: "relevant",
		mentioned: false,
		p: { addressed: 1 },
	});
});

test("a mention always reaches the agent: recorded, or only in the text", async () => {
	const recorded = await judge(incoming({}, { mentions: [me] }), facts(never));
	expect(recorded).toMatchObject({ kind: "relevant", mentioned: true });
	const tagged = await judge(
		incoming({
			text: `<m-user-mention>{"userId":"${me}","email":"agent@example.com"}</m-user-mention> hi`,
		}),
		facts(never),
	);
	expect(tagged).toMatchObject({ kind: "relevant", mentioned: true });
});

test("a mention of someone else goes to the screen", async () => {
	const verdict = await judge(
		incoming({
			text: '<m-user-mention>{"userId":"macro|bo@example.com"}</m-user-mention> hi',
		}),
		facts(async () => ({ addressed_to_me: 0.1 })),
	);
	expect(verdict.kind).toBe("irrelevant");
});

test("the screen is told the agent's configured name and id", async () => {
	const asked: unknown[] = [];
	await judge(
		incoming({ text: "Pip, can you look at this?" }),
		facts(async (input) => {
			asked.push(input);
			return { addressed_to_me: 0.9 };
		}),
	);
	expect(asked[0]).toMatchObject({ assistant: { name: "Pip", id: me } });
});

test("any of the screen's questions clearing the bar is enough; other keys count for nothing", () => {
	const two = {
		threshold: 0.6,
		questions: { addressed_to_me: "?", about_my_work: "?" },
	};
	expect(isRelevant({ addressed_to_me: 0.6 }, two)).toBe(true);
	expect(isRelevant({ about_my_work: 0.7 }, two)).toBe(true);
	expect(isRelevant({ addressed_to_me: 0.5, about_my_work: 0.5 }, two)).toBe(
		false,
	);
	expect(isRelevant({ fallback: 1, something_else: 1 }, two)).toBe(false);
	expect(isRelevant({ addressed_to_me: 0.9 }, screen)).toBe(true);
});

test("a failing screen is asked again with less history", async () => {
	const asked: unknown[] = [];
	const history = [1, 2, 3, 4].map((n) => entry({ id: `h${n}` }));
	const verdict = await judge(
		incoming(),
		facts(async (input) => {
			asked.push(input);
			if (asked.length === 1) throw new Error("400");
			return { addressed_to_me: 0.9 };
		}, history),
	);
	expect(verdict.kind).toBe("relevant");
	expect(asked).toHaveLength(2);
	expect(asked[1]).toMatchObject({
		recent_messages: [{ id: "h3" }, { id: "h4" }],
	});
});

test("when the screen keeps failing, a reply in a thread the agent is in is for it", async () => {
	const failing = async (): Promise<Probabilities> => {
		throw new Error("400");
	};
	const history = [entry({ id: "t1", sender_id: me, thread: "root1" })];
	const inside = await judge(
		incoming({ thread: "root1" }),
		facts(failing, history),
	);
	expect(inside).toMatchObject({ kind: "relevant", p: { fallback: 1 } });
	const outside = await judge(
		incoming({ thread: "other" }),
		facts(failing, history),
	);
	expect(outside.kind).toBe("irrelevant");
	expect(inThread(history, me, null)).toBe(false);
});
