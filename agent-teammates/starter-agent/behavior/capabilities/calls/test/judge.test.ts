import { expect, test } from "bun:test";
import {
	arbitrate,
	type Pending,
	pending,
	ruleOut,
	wanted,
	type World,
	type WorldCall,
} from "../arbiter.ts";
import { after } from "../config.ts";
import {
	beforeCallMs,
	type Candidate,
	type Decision,
	decisionKey,
	decisionLine,
	gatherCandidate,
	type JudgePorts,
	judgeModel,
	judgePrompt,
	judgeWithClaude,
	judgments,
	lookMs,
	maxAbout,
	maxJudgments,
	modelGapMs,
	parseVerdict,
	saysNothing,
	type Verdict,
} from "../judge.ts";
import type { ActiveMeeting, ChannelMessage } from "../types.ts";

const assistant = "macro|agent@example.com";
const owner = "macro|owner@example.com";
const cy = "macro|cy@example.com";
const start = Temporal.Instant.from("2026-11-05T14:00:00Z");
const at = (ms: number) => after(start, ms);
const world = (over: Partial<World> = {}): World => ({
	me: assistant,
	owner,
	calls: [],
	meetings: [],
	allowed: new Set(),
	hungUp: new Set(),
	judged: new Map(),
	...over,
});
const call = (over: Partial<WorldCall> = {}): WorldCall => ({
	callId: "c1",
	channelId: "ch1",
	createdBy: cy,
	ringing: false,
	dm: false,
	name: "Engineers",
	...over,
});
const meeting = (over: Partial<ActiveMeeting> = {}): ActiveMeeting => ({
	id: "m1",
	callId: "mc",
	title: "Drive connector",
	token: "tok",
	createdBy: cy,
	...over,
});
const said = (id: string, text = "about the roadmap") => ({
	id,
	from: "Cy",
	at: "2026-11-05T14:00:00Z",
	text,
});
const engineers = (messages: Candidate["messages"]): Candidate => ({
	kind: "channel",
	title: "",
	channel: "Engineers",
	createdBy: cy,
	attendees: [],
	messages,
});
const noTries = new Map();
const nobody = () => false;
const clock = { now: () => start };

/** Judgments with stubs, and a channel that says whatever `messages` holds. */
const rig = (
	verdict: Verdict = { join: true, reason: "about the roadmap", by: "model" },
) => {
	const log: Decision[] = [];
	const asks: Candidate[] = [];
	const reads: string[] = [];
	const failures: string[] = [];
	const state: {
		messages: Candidate["messages"];
		fail: boolean;
		verdict: Verdict;
	} = { messages: [said("m1")], fail: false, verdict };
	const judging = judgments({
		gather: async (seen) => {
			reads.push(seen.callId);
			if (state.fail) throw new Error("macro down");
			return {
				kind: seen.kind,
				title: seen.kind === "invite" ? seen.title : "",
				channel: seen.kind === "channel" ? seen.channel : "",
				createdBy: seen.createdBy,
				attendees: [],
				messages: seen.kind === "channel" ? state.messages : [],
			};
		},
		judge: async (candidate) => {
			asks.push(candidate);
			return state.verdict;
		},
		load: async () => undefined,
		record: (decision) => {
			log.push(decision);
		},
		clock,
		failed: (callId, error) => failures.push(`${callId}: ${error}`),
	});
	const tick = async (
		seen: World,
		busy: boolean,
		ms: number,
		inCall: readonly string[] = [],
	) => {
		judging.tick(seen, new Set(inCall), busy, at(ms));
		await judging.settled();
	};
	return { judging, log, asks, reads, failures, state, tick };
};

// What always gets answered never reaches a judgment.

test("ringing, its DMs, allowlisted rooms and the owner's invites are not decisions", () => {
	const seen = world({
		calls: [
			call({ callId: "ring", ringing: true }),
			call({ callId: "dm", dm: true, name: "" }),
			call({ callId: "room", channelId: "test" }),
			call({ callId: "own", createdBy: assistant }),
			call({ callId: "gone" }),
		],
		meetings: [
			meeting({ callId: "owner", createdBy: owner }),
			meeting({ callId: "mine", createdBy: assistant }),
			meeting({ callId: "notoken", token: null }),
		],
		allowed: new Set(["test"]),
		hungUp: new Set(["gone"]),
	});
	expect(pending(seen)).toEqual([]);
	expect(
		wanted(seen)
			.map(({ callId }) => callId)
			.sort(),
	).toEqual(["dm", "owner", "ring", "room"]);
});

test("the owner's plain channel call is a decision too: the agent doesn't barge into every call the owner starts", () => {
	const seen = world({ calls: [call({ createdBy: owner })] });
	expect(pending(seen).map(({ callId }) => callId)).toEqual(["c1"]);
	expect(wanted(seen)).toEqual([]);
});

// The limits, before any model.

test("busy on a call: stay out, no chat read, no model spent, one logged reason", async () => {
	const { tick, reads, asks, log } = rig();
	const seen = world({ calls: [call()] });
	for (let ms = 0; ms < 60_000; ms += 3000) await tick(seen, true, ms);
	expect(reads).toEqual([]);
	expect(asks).toEqual([]);
	expect(log.map(({ join, reason }) => [join, reason])).toEqual([
		[false, "on another call"],
	]);
});

test("a quiet channel: stay out without a model, the same no only once", async () => {
	const { tick, asks, log, state } = rig();
	state.messages = [];
	const seen = world({ calls: [call()] });
	for (let ms = 0; ms < 60_000; ms += 3000) await tick(seen, false, ms);
	expect(asks).toEqual([]);
	expect(log.map(({ reason }) => reason)).toEqual([
		"nothing in the channel says what it's about",
	]);
});

// One decision per call, re-made only when something real changes.

test("one decision per call, however many ticks, and the channel is reread on its own clock", async () => {
	const { tick, asks, log, reads } = rig({
		join: false,
		reason: "not its topic",
		by: "model",
	});
	const seen = world({ calls: [call()] });
	for (let ms = 0; ms < 60_000; ms += 3000) await tick(seen, false, ms);
	expect(asks).toHaveLength(1);
	expect(log).toHaveLength(1);
	expect(reads.length).toBe(Math.ceil(60_000 / lookMs));
});

test("the channel explains the call: a no becomes a yes", async () => {
	const { tick, judging, log, state } = rig({
		join: false,
		reason: "says nothing useful",
		by: "model",
	});
	state.messages = [said("m1", "hopping on")];
	const seen = world({ calls: [call()] });
	await tick(seen, false, 0);
	expect(judging.verdicts().get("c1")?.join).toBe(false);
	state.messages = [
		said("m1", "hopping on"),
		said("m2", "its about the drive connector"),
	];
	state.verdict = { join: true, reason: "Drive connector", by: "model" };
	await tick(seen, false, modelGapMs);
	expect(judging.verdicts().get("c1")).toMatchObject({
		join: true,
		reason: "Drive connector",
		messages: 2,
		kind: "channel",
		channel: "Engineers",
		createdBy: cy,
	});
	expect(log).toHaveLength(2);
});

test("it became free: busy no is re-made as soon as the next tick", async () => {
	const { tick, judging, log } = rig();
	const seen = world({ calls: [call()] });
	await tick(seen, true, 0);
	expect(judging.verdicts().get("c1")?.join).toBe(false);
	await tick(seen, false, 3000);
	expect(judging.verdicts().get("c1")?.join).toBe(true);
	expect(log.map(({ reason }) => reason)).toEqual([
		"on another call",
		"about the roadmap",
	]);
});

test("a chatty channel costs at most one judgment a minute and six a call", async () => {
	const { tick, asks, state } = rig({ join: false, reason: "no", by: "model" });
	const seen = world({ calls: [call()] });
	for (let ms = 0; ms < 30 * 60_000; ms += lookMs) {
		state.messages = [...state.messages, said(`m${ms}`)];
		await tick(seen, false, ms);
		if (ms < modelGapMs) expect(asks.length).toBe(1);
	}
	expect(asks.length).toBe(maxJudgments);
});

test("a yes stands until it joins, and the call it's in is left alone", async () => {
	const { tick, judging, asks, state } = rig();
	const seen = world({ calls: [call()] });
	await tick(seen, false, 0);
	state.messages = [said("m1"), said("m2", "now about lunch")];
	await tick(seen, false, modelGapMs);
	await tick(seen, false, modelGapMs * 2, ["c1"]);
	await tick(seen, true, modelGapMs * 3, ["c1"]);
	expect(asks).toHaveLength(1);
	expect(judging.verdicts().get("c1")?.join).toBe(true);
});

test("a call that's over is forgotten", async () => {
	const { tick, judging } = rig();
	await tick(world({ calls: [call()] }), false, 0);
	expect(judging.verdicts().size).toBe(1);
	await tick(world(), false, 3000);
	expect(judging.verdicts().size).toBe(0);
});

const stubs = (over: Partial<JudgePorts>): JudgePorts => ({
	gather: async () => engineers([said("m1")]),
	judge: async () => ({ join: true, reason: "x", by: "model" }),
	load: async () => undefined,
	record: () => {},
	clock,
	...over,
});

test("a restart doesn't decide twice: the logged decision is the decision", async () => {
	const log: Decision[] = [];
	const asks: Candidate[] = [];
	const judging = judgments(
		stubs({
			judge: async (candidate) => {
				asks.push(candidate);
				return { join: true, reason: "x", by: "model" };
			},
			load: async () => ({
				join: false,
				reason: "not its topic",
				by: "model",
				callId: "c1",
				key: decisionKey(engineers([said("m1")])),
				at: "",
				kind: "channel",
				title: "",
				channel: "Engineers",
				createdBy: cy,
			}),
			record: (decision) => {
				log.push(decision);
			},
		}),
	);
	judging.tick(world({ calls: [call()] }), new Set(), false, at(0));
	await judging.settled();
	expect(asks).toEqual([]);
	expect(log).toEqual([]);
	expect(judging.verdicts().get("c1")?.reason).toBe("not its topic");
});

test("a failed read decides nothing, and the next look tries again", async () => {
	const { tick, judging, log, failures, state } = rig();
	state.fail = true;
	const seen = world({ calls: [call()] });
	await tick(seen, false, 0);
	expect(log).toEqual([]);
	expect(failures).toEqual(["c1: Error: macro down"]);
	state.fail = false;
	await tick(seen, false, lookMs);
	expect(judging.verdicts().get("c1")?.join).toBe(true);
});

test("tick never waits: a slow judgment leaves the loop free and starts no second one", async () => {
	const answer = Promise.withResolvers<Verdict>();
	let asked = 0;
	const judging = judgments(
		stubs({
			judge: () => {
				asked++;
				return answer.promise;
			},
		}),
	);
	const seen = world({ calls: [call()] });
	judging.tick(seen, new Set(), false, at(0));
	// Let the look reach the model.
	await new Promise((resolve) => setTimeout(resolve, 0));
	judging.tick(seen, new Set(), false, at(lookMs * 2));
	expect(judging.verdicts().size).toBe(0);
	expect(asked).toBe(1);
	answer.resolve({ join: true, reason: "ok", by: "model" });
	await judging.settled();
	expect(judging.verdicts().get("c1")?.join).toBe(true);
});

// The verdict and the watcher together.

const judged = (id: string, join = true) =>
	new Map([[id, { join, reason: "Drive connector" }]]);
const decide = (seen: World, inCall: Parameters<typeof arbitrate>[1] = []) =>
	arbitrate(seen, inCall, start, noTries, nobody);

test("a yes on a channel call: it joins it uninvited, tells nobody", () => {
	const plan = decide(world({ calls: [call()], judged: judged("c1") }));
	expect(plan.join).toMatchObject({
		callId: "c1",
		uninvited: true,
		protects: false,
		tellAt: null,
		why: "decided: Drive connector",
	});
	expect(plan.tell).toEqual([]);
});

test("a no on a channel call or an invite: no join, no message, not even to its creator", () => {
	const seen = world({
		calls: [call()],
		meetings: [meeting()],
		judged: new Map([
			["c1", { join: false, reason: "not its topic" }],
			["mc", { join: false, reason: "not its topic" }],
		]),
	});
	expect(decide(seen)).toMatchObject({ join: null, leaving: null, tell: [] });
});

test("a yes on an invite joins it as invited: normal greeting, normal recording", () => {
	const plan = decide(world({ meetings: [meeting()], judged: judged("mc") }));
	expect(plan.join).toMatchObject({
		callId: "mc",
		args: ["meeting", "tok"],
		tellAt: null,
	});
	expect(plan.join?.uninvited).toBeUndefined();
});

test("a call it chose never moves it: not from a DM, even the owner's channel call", () => {
	const seen = world({
		calls: [
			call({ createdBy: owner }),
			call({ callId: "cy", channelId: "d", dm: true, name: "" }),
		],
		judged: judged("c1"),
	});
	const plan = decide(seen, [{ pid: 1, callId: "cy", args: ["channel", "d"] }]);
	expect(plan.leaving).toBeNull();
	expect(plan.join).toBeNull();
	expect(plan.tell).toEqual([]);
});

test("the owner's call still pulls it out of one it chose: it says why, and nothing goes in the channel", () => {
	const seen = world({
		calls: [
			call(),
			call({
				callId: "owner",
				channelId: "d",
				dm: true,
				name: "",
				createdBy: owner,
			}),
		],
		judged: judged("c1"),
	});
	const plan = decide(seen, [
		{ pid: 1, callId: "c1", args: ["channel", "ch1"] },
	]);
	expect(plan.leaving?.joins.map(({ pid }) => pid)).toEqual([1]);
	expect(plan.leaving?.to).toBeNull();
});

test("a direct call beats one it chose when it's free", () => {
	const seen = world({
		calls: [call(), call({ callId: "zz", channelId: "d", dm: true, name: "" })],
		judged: judged("c1"),
	});
	expect(decide(seen).join?.callId).toBe("zz");
});

test("the owner's invite is always answered, and a busy agent still tells them", () => {
	const seen = world({
		calls: [call({ callId: "other", dm: true, createdBy: owner, name: "" })],
		meetings: [meeting({ createdBy: owner })],
	});
	const plan = decide(seen, [
		{ pid: 1, callId: "other", args: ["channel", "ch1"] },
	]);
	expect(plan.tell.map(({ to }) => to)).toEqual([{ dm: owner }]);
	expect(
		decide(world({ meetings: [meeting({ createdBy: owner })] })).join?.callId,
	).toBe("mc");
});

// The evidence.

const message = (id: string, fromId: string, text = "x"): ChannelMessage => ({
	id,
	from: fromId,
	fromId,
	at: "2026-11-05T14:00:00Z",
	text,
});

test("the evidence: an invite's title and who's there; a channel's chat from ten minutes before its call, never its own words or a bot's", async () => {
	const asked: unknown[] = [];
	const api = {
		attendees: async (token: string) => {
			asked.push(token);
			return ["Cy"];
		},
		messagesSince: async (channelId: string, since: Temporal.Instant) => {
			asked.push([channelId, since.toString()]);
			return [
				message("m1", cy, "drive connector"),
				message("m2", assistant),
				message("m3", "bot|x"),
				...Array.from({ length: 30 }, (_, i) => message(`n${i}`, cy)),
			];
		},
	};
	const invite: Pending = {
		kind: "invite",
		callId: "mc",
		token: "tok",
		title: "Macro call",
		createdBy: cy,
	};
	expect(
		await gatherCandidate(invite, { api, me: assistant, now: start }),
	).toEqual({
		kind: "invite",
		title: "Macro call",
		channel: "",
		createdBy: cy,
		attendees: ["Cy"],
		messages: [],
	});
	const channel: Pending = {
		kind: "channel",
		callId: "c1",
		channelId: "ch1",
		channel: "Engineers",
		createdBy: cy,
		createdAt: "2026-11-05T13:00:00Z",
		count: 2,
	};
	const candidate = await gatherCandidate(channel, {
		api,
		me: assistant,
		now: start,
	});
	expect(candidate).toMatchObject({
		kind: "channel",
		channel: "Engineers",
		count: 2,
	});
	expect(candidate.messages).toHaveLength(20);
	expect(candidate.messages.at(-1)?.id).toBe("n29");
	expect(candidate.messages.some(({ id }) => id === "m2" || id === "m3")).toBe(
		false,
	);
	// A call with no start time is read from ten minutes ago.
	await gatherCandidate(
		{ ...channel, createdAt: undefined },
		{ api, me: assistant, now: start },
	);
	expect(asked).toEqual([
		"tok",
		["ch1", "2026-11-05T12:50:00Z"],
		["ch1", after(start, -beforeCallMs).toString()],
	]);
});

test("a busy or empty case is ruled before the model", () => {
	expect(
		ruleOut(
			{
				kind: "invite",
				callId: "x",
				token: "t",
				title: "Drive connector",
				createdBy: cy,
			},
			true,
		)?.reason,
	).toBe("on another call");
	expect(saysNothing(engineers([]))).not.toBeNull();
	expect(
		saysNothing({
			kind: "invite",
			title: "Macro call",
			channel: "",
			createdBy: cy,
			attendees: ["Cy"],
			messages: [],
		}),
	).toBeNull();
});

test("verdicts: only a clean yes is a yes", () => {
	expect(parseVerdict('{"join": true, "reason": "Drive"}')).toEqual({
		join: true,
		reason: "Drive",
		by: "model",
	});
	expect(
		parseVerdict('```json\n{"join": false, "reason": "not its topic"}\n```')
			.join,
	).toBe(false);
	for (const bad of [
		"",
		"yes",
		'{"join": "true", "reason": "x"}',
		'{"join": true}',
		'{"join": true, "reason": ""}',
		"{broken",
	])
		expect(parseVerdict(bad)).toMatchObject({ join: false, by: "rule" });
});

test("the model is tried twice; a failure is a no with the reason on record", async () => {
	const candidate = engineers([said("m1")]);
	const context = { about: "c", work: "w" };
	const asked: string[] = [];
	const flaky = await judgeWithClaude(candidate, context, async (_, model) => {
		asked.push(model);
		if (asked.length === 1) throw new Error("claude exited 1");
		return '{"join": true, "reason": "roadmap"}';
	});
	expect(flaky).toEqual({ join: true, reason: "roadmap", by: "model" });
	expect(asked).toEqual([judgeModel, judgeModel]);
	const down = await judgeWithClaude(candidate, context, () =>
		Promise.reject(new Error("claude exited 1")),
	);
	expect(down).toEqual({
		join: false,
		reason: "judgment failed: Error: claude exited 1",
		by: "rule",
	});
});

test("the prompt gets what the agent is for, capped, and caps what the channel can put in it", () => {
	const long = "x".repeat(1000);
	const prompt = judgePrompt(
		engineers(Array.from({ length: 50 }, (_, i) => said(`m${i}`, long))),
		{ about: `Mission.${"y".repeat(maxAbout)}`, work: "Drive" },
	);
	expect(prompt).toContain("Mission.");
	expect(prompt).not.toContain("y".repeat(maxAbout));
	expect(prompt).toContain("Drive");
	expect(prompt).not.toContain("x".repeat(301));
	expect(prompt.match(/"from"/g)).toHaveLength(20);
});

test("a decision reads as one log line", () => {
	expect(
		decisionLine({
			join: false,
			reason: "not its topic",
			by: "model",
			callId: "c1",
			key: "k",
			at: "",
			kind: "channel",
			title: "",
			channel: "Engineers",
			createdBy: cy,
		}),
	).toBe("decided c1 stay out (model) Engineers - not its topic");
});
