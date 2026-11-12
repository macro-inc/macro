import { expect, test } from "bun:test";
import { FlushSentinel, initializeLogger, llm, voice } from "@livekit/agents";
import { silent, type ToolStart } from "../brain.ts";
import { ClaudeCodeLlm, VoiceAgent } from "../context/voiceLive.ts";
import { stubBrain } from "../replay.ts";
import {
	addressing,
	type CallScreen,
	callScreen,
	cardWaitMs,
	cutOffText,
	followUpMs,
	namePattern,
	onlyWhatsForAgent,
	replyStream,
	type Speech,
	sayBeforeLeaving,
	agentTurns,
	withoutSilent,
} from "../session.ts";
import type { WorkingTime } from "../working.ts";

initializeLogger({ pretty: false, level: "silent" });

const flush = Symbol("flush");
type Chunk = string | typeof flush;

const read = async <Value>(
	stream: ReadableStream<Value>,
): Promise<readonly Value[]> => {
	const chunks: Value[] = [];
	const reader = stream.getReader();
	for (;;) {
		const next = await reader.read();
		if (next.done) return chunks;
		chunks.push(next.value);
	}
};
const from = (...chunks: readonly (string | ToolStart)[]) =>
	(async function* () {
		yield* chunks;
	})();
const noBrain = { interrupt: () => undefined };
const reply = (replies: AsyncIterable<string | ToolStart>) =>
	replyStream<typeof flush>({
		replies,
		turn: 1,
		brain: noBrain,
		emit: () => undefined,
		flush,
	});
const spoken = async (stream: ReadableStream<Chunk>) =>
	(await read(stream)).filter((chunk) => typeof chunk === "string").join("");

/** Time that never passes by itself: a sleep ends only when the test says so. */
const stillTime = (): WorkingTime & { readonly wake: () => void } => {
	let sleepers: (() => void)[] = [];
	return {
		now: () => 0,
		wall: () => 0,
		sleep: () =>
			new Promise<void>((resolve) => {
				sleepers.push(resolve);
			}),
		wake: () => {
			for (const wake of sleepers) wake();
			sleepers = [];
		},
	};
};

const yes = async (
	addressed: ReturnType<typeof addressing>,
	who: string,
	name: string,
	text: string,
	humans: number,
	now: number,
) => (await addressed.forAgent(who, name, text, humans, now)).forAgent;

test("1:1: every line is for the agent, and the screen isn't asked", async () => {
	let asked = 0;
	const addressed = addressing({
		name: "Sam",
		screen: async () => {
			asked++;
			return 0;
		},
	});
	expect(await yes(addressed, "a", "Ann", "what time is it", 1, 0)).toBe(true);
	expect(asked).toBe(0);
});

test("uninvited: alone with someone still takes its name", async () => {
	const addressed = addressing({ name: "Sam", nameOnly: true });
	expect(
		await yes(addressed, "a", "Ann", "so the plan for the launch", 1, 0),
	).toBe(false);
	expect(
		await yes(addressed, "a", "Ann", "Sam, what do you think?", 1, 1000),
	).toBe(true);
	expect(addressed.context()).toEqual(["Ann: so the plan for the launch"]);
});

test("uninvited: the event log keeps what was said to the agent and drops what it overheard", () => {
	const out: (readonly [string, unknown])[] = [];
	const emit = onlyWhatsForAgent((type, data) => out.push([type, data]));
	emit("stt.final", { text: "private" });
	emit("stt.interim", { text: "private" });
	emit("item", { role: "user", text: "private" });
	emit("turn.heard", { who: "a", text: "private", forAgent: false });
	emit("turn.heard", { who: "a", text: "Sam, hi", forAgent: true });
	emit("item", { role: "assistant", text: "hi" });
	emit("call.leave", { why: "x" });
	expect(JSON.stringify(out)).not.toContain("private");
	expect(out.at(-3)).toEqual([
		"turn.heard",
		{ who: "a", text: "Sam, hi", forAgent: true },
	]);
	expect(out.at(-2)).toEqual(["item", { role: "assistant", text: "hi" }]);
});

test("group without the screen: its name, or a follow-up from whoever it just answered; the rest is context", async () => {
	const addressed = addressing({ name: "Sam" });
	expect(await yes(addressed, "a", "Ann", "so anyway, lunch?", 2, 0)).toBe(
		false,
	);
	expect(await yes(addressed, "a", "Ann", "Sam, you there?", 2, 1000)).toBe(
		true,
	);
	expect(addressed.context()).toEqual(["Ann: so anyway, lunch?"]);
	expect(addressed.context()).toEqual([]);
	expect(
		await yes(
			addressed,
			"a",
			"Ann",
			"and the other thing",
			2,
			1000 + followUpMs - 1,
		),
	).toBe(true);
	expect(await yes(addressed, "b", "Bo", "not me", 2, 1000)).toBe(false);
	expect(
		await yes(addressed, "a", "Ann", "much later", 2, 1000 + 3 * followUpMs),
	).toBe(false);
});

/** The screen, scripted: the score for each newest line, and what it was shown. */
const scripted = (scores: Readonly<Record<string, number>>) => {
	const asked: Parameters<CallScreen>[0][] = [];
	const screen: CallScreen = async (input) => {
		asked.push(input);
		const score = scores[input.newest_line];
		if (score === undefined)
			throw new Error(`no score for ${input.newest_line}`);
		return score;
	};
	return { asked, screen };
};

test("group: the screen decides, so side talk stays side talk even right after the agent answered", async () => {
	const { asked, screen } = scripted({
		"Ann: Sam, what's the status of Slack?": 0.98,
		"Ann: why only there?": 0.97,
		"Ann: Bo, did you see that thread?": 0.02,
		"Bo: I think Sam would hate it honestly": 0.03,
		"Bo: and what about Teams?": 0.88,
	});
	const addressed = addressing({ name: "Sam", screen });
	expect(
		await addressed.forAgent(
			"a",
			"Ann",
			"Sam, what's the status of Slack?",
			2,
			0,
		),
	).toEqual({ forAgent: true, p: 0.98 });
	addressed.said("Slack works in our home workspace only.");
	// A follow-up with no name, then a turn to someone else inside the follow-up window.
	expect(await yes(addressed, "a", "Ann", "why only there?", 2, 1000)).toBe(
		true,
	);
	expect(
		await yes(addressed, "a", "Ann", "Bo, did you see that thread?", 2, 2000),
	).toBe(false);
	// Its name, about it, not to it.
	expect(
		await yes(
			addressed,
			"b",
			"Bo",
			"I think Sam would hate it honestly",
			2,
			3000,
		),
	).toBe(false);
	// Someone else picking up what it said.
	expect(
		await yes(addressed, "b", "Bo", "and what about Teams?", 2, 4000),
	).toBe(true);
	expect(asked.at(1)).toEqual({
		setting: callScreen.setting("Sam"),
		recent_lines: [
			"Ann: Sam, what's the status of Slack?",
			"Sam: Slack works in our home workspace only.",
		],
		newest_line: "Ann: why only there?",
	});
	expect(addressed.context()).toEqual([
		"Ann: Bo, did you see that thread?",
		"Bo: I think Sam would hate it honestly",
	]);
});

test("group: the screen failing or slow falls back to the rule", async () => {
	const addressed = addressing({
		name: "Sam",
		screen: async (input) => {
			if (input.newest_line.includes("slow"))
				return new Promise((resolve) =>
					setTimeout(() => resolve(0), callScreen.waitMs + 200),
				);
			throw new Error("Macro is down");
		},
	});
	expect(await addressed.forAgent("a", "Ann", "Sam, you there?", 2, 0)).toEqual(
		{
			forAgent: true,
		},
	);
	expect(await yes(addressed, "b", "Bo", "lunch?", 2, 100)).toBe(false);
	expect(await yes(addressed, "b", "Bo", "Sam, slow one", 2, 200)).toBe(true);
});

test("uninvited group: the screen's yes still needs its name or a follow-up", async () => {
	const { screen } = scripted({
		"Ann: can someone check the gateway?": 0.9,
		"Ann: Sam, can you check the gateway?": 0.95,
	});
	const addressed = addressing({ name: "Sam", nameOnly: true, screen });
	expect(
		await yes(addressed, "a", "Ann", "can someone check the gateway?", 2, 0),
	).toBe(false);
	expect(
		await yes(addressed, "a", "Ann", "Sam, can you check the gateway?", 2, 10),
	).toBe(true);
});

test("a line from someone else's listener turns the agent to them; the linked person's own listener is ignored", async () => {
	const events: (readonly [string, unknown])[] = [];
	const { screen } = scripted({ "Bo: Sam, can you hear me too?": 0.97 });
	const turns = agentTurns({
		brain: stubBrain(() => undefined),
		speakers: ann(2),
		addressing: addressing({ name: "Sam", screen }),
		emit: (type, data) => events.push([type, data]),
		now: () => 0,
		time: stillTime(),
		flush,
	});
	expect(await turns.overheard("macro|a", "Ann", "hello")).toBe(false);
	expect(
		await turns.overheard("macro|b", "Bo", "Sam, can you hear me too?"),
	).toBe(true);
	expect(events).toEqual([
		[
			"turn.heard",
			{
				who: "macro|b",
				text: "Sam, can you hear me too?",
				forAgent: true,
				p: 0.97,
				by: "ear",
			},
		],
	]);
});

test('the silent marker never reaches the voice, whole or split, even after "Bye."', async () => {
	expect(await spoken(reply(from(silent)))).toBe("");
	expect(await spoken(reply(from("(sil", "ent)")))).toBe("");
	expect(await spoken(reply(from("Bye.", silent)))).toBe("Bye.");
	expect(await spoken(reply(from("Bye (for", " now)")))).toBe("Bye (for now)");
	expect(withoutSilent("Bye.(si")).toEqual({ say: "Bye.", hold: "(si" });
});

test("talking over the agent cancels the reply and interrupts the brain", async () => {
	let interrupted = 0;
	const events: string[] = [];
	const reader = replyStream({
		replies: from("One. ", "Two."),
		turn: 7,
		brain: { interrupt: () => interrupted++ },
		emit: (type, data) => events.push(`${type}:${JSON.stringify(data)}`),
		flush,
	}).getReader();
	expect((await reader.read()).value).toBe("One. ");
	await reader.cancel();
	expect(interrupted).toBe(1);
	expect(events).toContain('turn.interrupt:{"turn":7}');
	expect(events).toContain('brain.text:{"turn":7,"text":"One."}');
});

test("a tool flushes what it said and opens a segment for the working sound", async () => {
	const working: (number | null)[] = [];
	const chunks = await read(
		replyStream({
			replies: from(
				"Checking.",
				{ tool: "Bash" },
				{ tool: "Read" },
				"Found it.",
			),
			turn: 1,
			brain: noBrain,
			emit: () => undefined,
			flush,
			working: (since) => working.push(since),
			now: () => 42,
		}),
	);
	expect(chunks).toEqual(["Checking.", flush, "", "Found it."]);
	// Its words: not working. The tool: working since then. Its answer: not working.
	expect(working).toEqual([null, 42, null, null]);
});

test("hang_up flushes the goodbye and plays no working sound", async () => {
	const working: (number | null)[] = [];
	const chunks = await read(
		replyStream({
			replies: from("Bye.", { tool: "mcp__call__hang_up" }),
			turn: 1,
			brain: noBrain,
			emit: () => undefined,
			flush,
			working: (since) => working.push(since),
		}),
	);
	expect(chunks).toEqual(["Bye.", flush]);
	expect(working.every((since) => since === null)).toBe(true);
});

test("a brain that fails mid-reply ends the reply, and says so in the log", async () => {
	const events: string[] = [];
	const failing = (async function* (): AsyncGenerator<string> {
		yield "One sec.";
		throw new Error("session gone");
	})();
	const chunks = await read(
		replyStream({
			replies: failing,
			turn: 3,
			brain: noBrain,
			emit: (type) => events.push(type),
			flush,
		}),
	);
	expect(chunks).toEqual(["One sec."]);
	expect(events).toEqual(["brain.error", "brain.text", "brain.done"]);
});

test("the brain is told how much of its answer they heard", () => {
	const chat = new llm.ChatContext();
	chat.addMessage({
		role: "assistant",
		content: "The build started in",
		interrupted: true,
	});
	chat.addMessage({ role: "user", content: "stop" });
	expect(cutOffText(chat)).toBe("The build started in");
	const clean = new llm.ChatContext();
	clean.addMessage({ role: "assistant", content: "done" });
	expect(cutOffText(clean)).toBeNull();
});

const ann = (humans: number) => ({
	humans: () => humans,
	current: () => ["macro|a", "Ann"] as const,
});
const userSays = (text: string) => {
	const chat = new llm.ChatContext();
	chat.addMessage({ role: "user", content: text });
	return chat;
};
const turnsWith = (
	asks: string[],
	options: {
		readonly card?: (who: string, alone: boolean) => Promise<string>;
		readonly time?: WorkingTime;
		readonly humans?: number;
		readonly events?: string[];
	} = {},
) =>
	agentTurns({
		brain: stubBrain((content) => asks.push(content)),
		speakers: ann(options.humans ?? 1),
		addressing: addressing({ name: "Sam" }),
		emit: (type) => options.events?.push(type),
		now: () => 0,
		time: options.time ?? stillTime(),
		card: options.card,
		flush,
	});

test("the brain gets a speaker's card the first time they speak, and only then", async () => {
	const asks: string[] = [];
	const asked: (readonly [string, boolean])[] = [];
	const turns = turnsWith(asks, {
		card: async (who, alone) => {
			asked.push([who, alone]);
			return "You like Ann.";
		},
	});
	await read(turns.reply(userSays("hello")));
	await read(turns.reply(userSays("and again")));
	expect(asked).toEqual([["macro|a", true]]);
	expect(asks).toEqual([
		"You like Ann.\n\nAnn [macro|a] says to you: hello",
		"Ann [macro|a] says to you: and again",
	]);
});

test("a card that is slow doesn't hold its answer: it goes with their next line", async () => {
	const asks: string[] = [];
	const time = stillTime();
	const card = Promise.withResolvers<string>();
	const turns = turnsWith(asks, { card: () => card.promise, time });
	const first = read(turns.reply(userSays("hello")));
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
	// The wait for the card runs out.
	time.wake();
	await first;
	card.resolve("You like Ann.");
	await read(turns.reply(userSays("still there?")));
	expect(cardWaitMs).toBeLessThanOrEqual(500);
	expect(asks).toEqual([
		"Ann [macro|a] says to you: hello",
		"You like Ann.\n\nAnn [macro|a] says to you: still there?",
	]);
});

test("a line not for the agent is logged and not answered; it reaches the brain with its next ask", async () => {
	const asks: string[] = [];
	const events: string[] = [];
	const turns = turnsWith(asks, { humans: 2, events });
	expect(await turns.heard("so anyway, lunch?")).toBe(false);
	expect(await turns.heard("Sam, are you there?")).toBe(true);
	await read(turns.reply(userSays("Sam, are you there?")));
	expect(events.slice(0, 3)).toEqual(["turn.heard", "turn.heard", "turn.ask"]);
	expect(asks).toEqual([
		"Said on the call since you last spoke:\nAnn: so anyway, lunch?\n\nAnn [macro|a] says to you: Sam, are you there?",
	]);
});

const realTime: WorkingTime = {
	now: () => performance.now(),
	wall: () => 0,
	sleep: (ms) => Bun.sleep(ms),
};

test("a real session replies through the brain (it needs an llm object to reply at all)", async () => {
	const asks: string[] = [];
	const session = new voice.AgentSession({ llm: new ClaudeCodeLlm() });
	await session.start({
		agent: new VoiceAgent(
			agentTurns({
				brain: stubBrain((content) => asks.push(content)),
				speakers: ann(1),
				addressing: addressing({ name: "Sam" }),
				emit: () => undefined,
				now: () => 0,
				time: realTime,
				flush: FlushSentinel,
			}),
		),
	});
	const result = await session.run({ userInput: "can you hear me" }).wait();
	expect(asks).toEqual(["Ann [macro|a] says to you: can you hear me"]);
	expect(
		result.events.some(
			(event) => event.type === "message" && event.item.textContent === "Okay.",
		),
	).toBe(true);
	await session.close();
});

// Leaving: it says why, and only then leaves; it can't get stuck doing it.

const speech = (playout: Promise<void>) => {
	const said: { readonly line: string; readonly options: unknown }[] = [];
	let interrupts = 0;
	const voiced: Speech = {
		interrupt: () => {
			interrupts++;
		},
		say: (line, options) => {
			said.push({ line, options });
			return playout;
		},
	};
	return { said, interrupts: () => interrupts, voiced };
};
const never = new Promise<void>(() => undefined);

test("it stops what it was saying, says the line uninterruptibly, and returns only when it has played", async () => {
	const played = Promise.withResolvers<void>();
	const leaving = speech(played.promise);
	const events: string[] = [];
	let returned = false;
	const heard = sayBeforeLeaving({
		line: "Sorry, Cy needs me. I've got to go.",
		speech: leaving.voiced,
		humans: 1,
		emit: (type) => events.push(type),
		sleep: () => never,
	}).then((value) => {
		returned = true;
		return value;
	});
	await Promise.resolve();
	await Promise.resolve();
	expect(returned).toBe(false);
	expect(leaving.interrupts()).toBe(1);
	expect(leaving.said).toEqual([
		{
			line: "Sorry, Cy needs me. I've got to go.",
			options: { allowInterruptions: false, addToChatCtx: false },
		},
	]);
	played.resolve();
	expect(await heard).toBe(true);
	expect(events).toEqual(["call.leave_line", "call.leave_line_done"]);
});

test("nobody on the call: nothing said, straight out", async () => {
	const leaving = speech(never);
	expect(
		await sayBeforeLeaving({
			line: "line",
			speech: leaving.voiced,
			humans: 0,
			emit: () => undefined,
			sleep: () => never,
		}),
	).toBe(true);
	expect(leaving.said).toEqual([]);
});

test("the voice hangs: the timeout gets it out, and says it was not heard", async () => {
	const waited: number[] = [];
	expect(
		await sayBeforeLeaving({
			line: "line",
			speech: speech(never).voiced,
			humans: 1,
			emit: () => undefined,
			sleep: async (ms) => {
				waited.push(ms);
			},
		}),
	).toBe(false);
	expect(waited).toEqual([10_000]);
});

test("the voice throws: out, not heard", async () => {
	const events: string[] = [];
	expect(
		await sayBeforeLeaving({
			line: "line",
			speech: speech(Promise.reject(new Error("tts down"))).voiced,
			humans: 1,
			emit: (type) => events.push(type),
			sleep: () => never,
		}),
	).toBe(false);
	expect(events).toContain("call.leave_line_failed");
});

test("the screen's question fits Macro's 500-character limit, with a name of up to 20 characters", () => {
	const question = callScreen.question("x".repeat(20));
	expect(question.length).toBeGreaterThan(100);
	expect(question.length).toBeLessThanOrEqual(500);
	expect(callScreen.question("Sam")).toContain("TO Sam");
});

test("its name is heard whatever the case and punctuation, as a word, and any name works", () => {
	expect(namePattern("Sam").test("sam, you there?")).toBe(true);
	expect(namePattern("Sam").test("SAM!")).toBe(true);
	expect(namePattern("Sam").test("the sample is ready")).toBe(false);
	expect(namePattern("Dr. Who").test("dr. who, hello")).toBe(true);
	expect(namePattern("Dr. Who").test("drx who")).toBe(false);
	expect(namePattern(" Ada ").test("thanks Ada")).toBe(true);
});
