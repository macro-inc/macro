import { expect, test } from "bun:test";
import {
	arbitrate,
	askGapMs,
	askRules,
	busyLine,
	type Cell,
	comingLine,
	type Decided,
	type InCall,
	insist,
	type Join,
	joinDue,
	joinErrorRules,
	leaveLine,
	maxMovesPerHour,
	maxPlaceFailures,
	maxWeighs,
	moveGapMs,
	type Plan,
	pending,
	placeRules,
	rateLimitedMs,
	rejoinAt,
	rules,
	stayLine,
	type Tries,
	type World,
	type WorldCall,
	wanted,
} from "../arbiter.ts";
import type { ActiveMeeting, Ask, Asks, Placed } from "../types.ts";

/** The tests count in milliseconds from the epoch; the same numbers here are instants. */
const at = (ms: number): Temporal.Instant =>
	Temporal.Instant.fromEpochMilliseconds(ms);

// The moving parts a test reads: what it's leaving, and what it says on the way out.
const decide = (...args: Parameters<typeof arbitrate>) => {
	const plan: Plan = arbitrate(...args);
	return {
		...plan,
		leave: plan.leaving?.joins ?? [],
		line: plan.leaving?.line ?? null,
		leaveTo: plan.leaving?.to ?? null,
	};
};
const assistant = "macro|agent@example.com";
const owner = "macro|owner@example.com";
const cy = "macro|cy@example.com";
const dee = "macro|dee@example.com";
const base = (over: Partial<World> = {}): World => ({
	me: assistant,
	owner,
	calls: [],
	meetings: [],
	allowed: new Set(),
	hungUp: new Set(),
	judged: new Map(),
	...over,
});
const call = (over: Partial<WorldCall>): WorldCall => ({
	callId: "c1",
	channelId: "ch1",
	createdBy: owner,
	ringing: false,
	dm: false,
	name: "general",
	...over,
});
const dm = (callId: string, createdBy: string): WorldCall =>
	call({ callId, channelId: `ch-${callId}`, createdBy, dm: true, name: "" });
const inCall = (callId: string, pid = 100): InCall => ({
	pid,
	callId,
	args: ["channel", `ch-${callId}`],
});
const told =
	(...ids: readonly string[]) =>
	(id: string) =>
		ids.includes(id);
const nobody = told();
const noTries = new Map<string, Tries>();
const meeting = (over: Partial<ActiveMeeting>): ActiveMeeting => ({
	id: "m",
	callId: "meet",
	title: "Standup",
	token: "tok",
	createdBy: owner,
	...over,
});

const design = await Bun.file(new URL("../DESIGN.md", import.meta.url)).text();
/** The first markdown table after a heading, cells trimmed, without its header. */
const specTable = (heading: string): readonly (readonly string[])[] => {
	const from = design.indexOf(heading);
	if (from < 0) throw new Error(`DESIGN.md has no "${heading}"`);
	const lines = design.slice(from).split("\n");
	const start = lines.findIndex((line) => line.startsWith("|"));
	const end = lines.findIndex(
		(line, index) => index > start && !line.startsWith("|"),
	);
	return lines.slice(start + 2, end).map((line) =>
		line
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim()),
	);
};

test("join refusal table matches DESIGN", () => {
	expect(specTable("## Refusals")).toEqual(
		joinErrorRules.map((rule) => [rule.refusal, rule.next]),
	);
	// The table says five minutes; the watcher's delay is this constant.
	expect(rateLimitedMs).toBe(5 * 60_000);
});

test("ghost refusals escalate after three, or immediately for a protected call", () => {
	const join: Join = {
		callId: "a",
		args: ["channel", "ch"],
		why: "dm",
		event: "person calling",
		rank: 1,
		protects: false,
		urgent: false,
		tellAt: null,
	};
	expect(
		insist(join, { failures: 2, refusal: "in_other_call", refusals: 2 }),
	).toEqual({});
	expect(
		insist(join, { failures: 3, refusal: "in_other_call", refusals: 3 }),
	).toEqual({ onOtherCall: "switch" });
	expect(
		insist(
			{ ...join, protects: true },
			{ failures: 1, refusal: "already_connected", refusals: 1 },
		),
	).toEqual({ replace: true });
});

test("ghost refusals: a call that moves the agent escalates at once, and other refusals never do", () => {
	const join: Join = {
		callId: "a",
		args: ["channel", "ch"],
		why: "dm",
		event: "owner calling",
		rank: 0,
		protects: false,
		urgent: true,
		tellAt: null,
	};
	expect(
		insist(join, { failures: 1, refusal: "in_other_call", refusals: 1 }),
	).toEqual({ onOtherCall: "switch" });
	expect(
		insist(join, { failures: 5, refusal: "flag_off", refusals: 5 }),
	).toEqual({});
	expect(insist(join, { failures: 5 })).toEqual({});
	expect(insist(join, undefined)).toEqual({});
});

// Calls it places. They come from the ledger, not Macro's list, because wanted skips calls it created.
const placed = (id: string, over: Partial<Placed> = {}): Placed => ({
	id,
	channelId: `ch-${id}`,
	target: cy,
	asker: cy,
	reason: "r",
	rule: "call-back",
	at: at(0),
	...over,
});
const inPlaced = (id: string): InCall => ({
	pid: 200,
	callId: `place-${id}`,
	args: ["channel", `ch-${id}`],
});

test("placed admission refusals end in the ledger, and rate limits wait five minutes", () => {
	const blocked = placed("blocked");
	const refuse = new Map<string, Tries>([
		["place-blocked", { failures: 1, refusal: "refused", refusals: 1 }],
	]);
	expect(
		decide(base({ placed: [blocked] }), [], at(10), refuse, nobody).closePlaced,
	).toMatchObject([{ event: "ended", why: "join refused" }]);
	const limited: Tries = {
		failures: 1,
		lastTry: at(0),
		lastExit: at(100),
		refusal: "rate_limited",
		refusals: 1,
		delayUntil: at(300_100),
	};
	expect(
		decide(
			base({ calls: [dm("a", cy)] }),
			[],
			at(300_000),
			new Map([["a", limited]]),
			nobody,
		).join,
	).toBeNull();
	expect(
		decide(
			base({ calls: [dm("a", cy)] }),
			[],
			at(300_100),
			new Map([["a", limited]]),
			nobody,
		).join?.callId,
	).toBe("a");
});

test("joins a DM call, a ringing call, and an allowlisted channel", () => {
	const world = base({
		calls: [
			call({ callId: "a", dm: true }),
			call({ callId: "b", ringing: true }),
			call({ callId: "c", channelId: "test" }),
		],
		allowed: new Set(["test"]),
	});
	expect(wanted(world).map((join) => [join.callId, join.why])).toEqual([
		["a", "dm"],
		["b", "ringing"],
		["c", "allowlisted"],
	]);
});

test("ignores plain channel calls, its own calls, hung-up calls", () => {
	const world = base({
		calls: [
			call({ callId: "a" }),
			call({ callId: "b", dm: true, createdBy: assistant }),
			call({ callId: "c", dm: true }),
		],
		hungUp: new Set(["c"]),
	});
	expect(wanted(world)).toEqual([]);
});

test("free: it starts a placed call, with nobody to tell", () => {
	const plan = decide(
		base({ placed: [placed("a")] }),
		[],
		at(0),
		noTries,
		nobody,
	);
	expect(plan.join).toMatchObject({
		callId: "place-a",
		args: ["channel", "ch-a"],
		tellAt: null,
	});
	expect(plan.tell).toEqual([]);
});

test("it stays in a call it started: the createdBy skip does not throw it out, and nobody gets a second join", () => {
	const world = base({
		placed: [placed("a")],
		calls: [
			call({
				callId: "room",
				channelId: "ch-a",
				createdBy: assistant,
				dm: true,
			}),
		],
	});
	const plan = decide(world, [inPlaced("a")], at(0), noTries, nobody);
	expect(plan.join).toBeNull();
	expect(plan.leave).toEqual([]);
});

test("one call: a placed call waits while it is on someone else's, and a person calling beats it", () => {
	const on = decide(
		base({ placed: [placed("a")], calls: [dm("c", cy)] }),
		[inCall("c")],
		at(0),
		noTries,
		nobody,
	);
	expect(on.join).toBeNull();
	expect(on.leave).toEqual([]);
	expect(on.tell).toEqual([]);
	expect(
		decide(
			base({ placed: [placed("a")], calls: [dm("01c", cy)] }),
			[],
			at(0),
			noTries,
			nobody,
		).join?.callId,
	).toBe("01c");
});

test("the owner calling moves it out of a call it placed", () => {
	const plan = decide(
		base({ placed: [placed("a")], calls: [dm("e", owner)] }),
		[inPlaced("a")],
		at(0),
		noTries,
		nobody,
	);
	expect(plan.leave).toEqual([inPlaced("a")]);
	expect(plan.leaveTo).toBeNull();
	// Said to whoever picked up; nobody there, nothing said.
	expect(plan.line).toBe(leaveLine.owner);
});

test("a failed placed join backs off instead of spinning", () => {
	const tries = new Map<string, Tries>([
		["place-a", { lastTry: at(0), lastExit: at(100), failures: 1 }],
	]);
	expect(
		decide(base({ placed: [placed("a")] }), [], at(150), tries, nobody).join,
	).toBeNull();
	expect(
		decide(base({ placed: [placed("a")] }), [], at(100_000), tries, nobody).join
			?.callId,
	).toBe("place-a");
});

test("joins the owner's meetings by share token", () => {
	const world = base({
		meetings: [
			meeting({ callId: "mc" }),
			meeting({ id: "n", callId: "nc", title: "No token", token: null }),
		],
	});
	expect(wanted(world)).toMatchObject([
		{ callId: "mc", args: ["meeting", "tok"], why: 'meeting "Standup"' },
	]);
});

// Macro holds a user in one call at a time, and a token request for a second
// call can remove the agent from the first: so it never asks for two.

test("two live DM calls: it joins one and stays for the whole minute", () => {
	const world = base({ calls: [dm("01aa", owner), dm("01bb", cy)] });
	const tries = new Map<string, Tries>();
	const joins: string[] = [];
	const here: InCall[] = [];
	for (let now = 0; now < 60_000; now += 3000) {
		const plan = decide(world, here, at(now), tries, nobody);
		expect(plan.leave).toEqual([]);
		if (plan.join === null) continue;
		joins.push(plan.join.callId);
		tries.set(plan.join.callId, { lastTry: at(now), failures: 0 });
		here.push(inCall(plan.join.callId));
	}
	expect(joins).toEqual(["01aa"]);
});

test("free with two callers: one join, the earliest caller first, and the other is told in the same tick", () => {
	const world = base({ calls: [dm("01b", cy), dm("01a", dee)] });
	const plan = decide(world, [], at(0), noTries, nobody);
	expect(plan.join?.callId).toBe("01a");
	expect(plan.tell).toEqual([
		{ callId: "01b", to: { channel: "ch-01b" }, text: busyLine },
	]);
});

test("a direct call beats a meeting or allowlisted channel that was there first", () => {
	const world = base({
		calls: [
			call({ callId: "01a", channelId: "test", createdBy: cy }),
			dm("01c", cy),
		],
		meetings: [meeting({ callId: "01b", createdBy: cy })],
		allowed: new Set(["test"]),
		judged: new Map([["01b", { join: true, reason: "x" }]]),
	});
	expect(decide(world, [], at(0), noTries, nobody).join?.callId).toBe("01c");
});

test("someone else calling while it is busy: it stays and they are told, once", () => {
	const world = base({ calls: [dm("in", cy), dm("new", dee)] });
	const first = decide(world, [inCall("in")], at(0), noTries, nobody);
	expect(first.join).toBeNull();
	expect(first.leave).toEqual([]);
	expect(first.tell).toEqual([
		{ callId: "new", to: { channel: "ch-new" }, text: busyLine },
	]);
	expect(
		decide(world, [inCall("in")], at(3000), noTries, told("new")).tell,
	).toEqual([]);
});

test("nobody is told about the call it is in, and no one waiting means no message", () => {
	expect(
		decide(
			base({ calls: [dm("in", cy)] }),
			[inCall("in")],
			at(0),
			noTries,
			nobody,
		).tell,
	).toEqual([]);
	expect(
		decide(base({ calls: [dm("a", cy)] }), [], at(0), noTries, nobody).tell,
	).toEqual([]);
});

test("a hung-up call never gets a message", () => {
	const world = base({
		calls: [dm("in", cy), dm("gone", cy)],
		hungUp: new Set(["gone"]),
	});
	expect(decide(world, [inCall("in")], at(0), noTries, nobody).tell).toEqual(
		[],
	);
});

test("a meeting has no channel: the owner waiting gets a DM; anyone else's invite is the agent's to decide, and says nothing", () => {
	const invite = (callId: string, createdBy: string) =>
		meeting({ id: callId, callId, token: `t-${callId}`, createdBy });
	const world = base({
		calls: [dm("in", owner)],
		meetings: [
			invite("owner", owner),
			invite("inner", dee),
			invite("outer", "macro|someone@acme.test"),
		],
		judged: new Map([
			["inner", { join: true, reason: "x" }],
			["outer", { join: true, reason: "x" }],
		]),
	});
	const { tell } = decide(world, [inCall("in")], at(0), noTries, nobody);
	expect(tell.map((notice) => [notice.callId, notice.to])).toEqual([
		["owner", { dm: owner }],
	]);
	expect(tell[0]?.text).toContain("Standup");
});

test("the owner calls during Cy's call: Cy is told, the agent leaves first, and joins only once it is out", () => {
	const world = base({ calls: [dm("cy", cy), dm("owner", owner)] });
	const moving = decide(world, [inCall("cy", 42)], at(0), noTries, nobody);
	// A second seat would evict it anyway; never two joins at once.
	expect(moving.join).toBeNull();
	expect(moving.leave.map((join) => join.pid)).toEqual([42]);
	expect(moving.line).toBe(leaveLine.owner);
	expect(moving.leaveTo).toEqual({ channel: "ch-cy" });
	// The owner isn't told it's busy: it's coming.
	expect(moving.tell).toEqual([]);

	const tries = new Map<string, Tries>([
		["cy", { lastTry: at(0), lastExit: at(300), failures: 0 }],
	]);
	const out = decide(world, [], at(300), tries, told("cy"));
	expect(out.join?.callId).toBe("owner");
	// Cy already knows.
	expect(out.tell).toEqual([]);
});

test("after the owner hangs up it goes back to the call it left, without a second message", () => {
	const world = base({ calls: [dm("cy", cy)] });
	const tries = new Map<string, Tries>([
		["cy", { lastTry: at(0), lastExit: at(300), failures: 0 }],
	]);
	const plan = decide(world, [], at(120_000), tries, told("cy"));
	expect(plan.join?.callId).toBe("cy");
	expect(plan.tell).toEqual([]);
});

test("a preempted person hears why even if they were told busy earlier", () => {
	const world = base({ calls: [dm("cy", cy), dm("owner", owner)] });
	expect(decide(world, [inCall("cy")], at(0), noTries, told("cy")).line).toBe(
		leaveLine.owner,
	);
});

test("in the owner's call nothing moves it, not even another call of the owner's", () => {
	const world = base({
		calls: [
			dm("owner", owner),
			dm("cy", cy),
			call({ callId: "room", channelId: "test", createdBy: owner }),
		],
		allowed: new Set(["test"]),
	});
	const plan = decide(world, [inCall("owner")], at(0), noTries, nobody);
	expect(plan.join).toBeNull();
	expect(plan.leave).toEqual([]);
});

test("only the owner preempts: a direct call does not move it out of a meeting", () => {
	const world = base({
		calls: [dm("cy", cy)],
		meetings: [meeting({ createdBy: "x" })],
		judged: new Map([["meet", { join: true, reason: "x" }]]),
	});
	expect(
		decide(
			world,
			[{ pid: 1, callId: "meet", args: ["meeting", "tok"] }],
			at(0),
			noTries,
			nobody,
		).leave,
	).toEqual([]);
});

test("the owner's meeting moves it out of a call too", () => {
	const world = base({ calls: [dm("cy", cy)], meetings: [meeting({})] });
	expect(
		decide(world, [inCall("cy")], at(0), noTries, nobody).leave,
	).toHaveLength(1);
});

test("a call of the owner's it already answered and left cannot pull it out again: no 15 s flap on a ghost call", () => {
	const world = base({ calls: [dm("owner", owner), dm("cy", cy)] });
	const tries = new Map<string, Tries>([
		["owner", { lastTry: at(0), lastExit: at(60_000), failures: 0 }],
	]);
	const free = decide(world, [], at(61_000), tries, told("cy"));
	// The owner's was served; Cy has waited longest.
	expect(free.join?.callId).toBe("cy");
	const later = decide(world, [inCall("cy")], at(120_000), tries, told("cy"));
	expect(later.leave).toEqual([]);
	expect(later.join).toBeNull();
});

test("the owner's failed join keeps the slot during its backoff, so Cy doesn't slip in and get thrown out a second later", () => {
	const world = base({ calls: [dm("owner", owner), dm("cy", cy)] });
	const tries = new Map<string, Tries>([
		["owner", { lastTry: at(0), lastExit: at(1000), failures: 1 }],
	]);
	const backingOff = decide(world, [], at(1500), tries, nobody);
	expect(backingOff.join).toBeNull();
	expect(backingOff.tell.map((notice) => notice.callId)).toEqual(["cy"]);
	expect(decide(world, [], at(2000), tries, told("cy")).join?.callId).toBe(
		"owner",
	);
});

test("a join still in flight counts as being in that call: no second token request", () => {
	const world = base({ calls: [dm("flying", cy), dm("other", dee)] });
	expect(
		decide(world, [inCall("flying")], at(0), noTries, nobody).join,
	).toBeNull();
});

test("the owner calling while a join is in flight: it is stopped first, the same as a call", () => {
	const world = base({ calls: [dm("flying", cy), dm("owner", owner)] });
	const plan = decide(world, [inCall("flying", 7)], at(0), noTries, nobody);
	expect(plan.join).toBeNull();
	expect(plan.leave.map((join) => join.pid)).toEqual([7]);
});

test("a join no one can place (manual, call gone from the list) still means busy; the owner still outranks it", () => {
	const unknown: InCall = {
		pid: 9,
		callId: null,
		args: ["channel", "somewhere"],
	};
	const forCy = decide(
		base({ calls: [dm("cy", cy)] }),
		[unknown],
		at(0),
		noTries,
		nobody,
	);
	expect(forCy.join).toBeNull();
	expect(forCy.tell.map((notice) => notice.callId)).toEqual(["cy"]);
	const forOwner = decide(
		base({ calls: [dm("owner", owner)] }),
		[unknown],
		at(0),
		noTries,
		nobody,
	);
	expect(forOwner.leave.map((join) => join.pid)).toEqual([9]);
	expect(forOwner.leaveTo).toBeNull();
});

// The rule tables are the tables in DESIGN.md. A rule change that skips the spec fails here.

test("rules is the table in DESIGN.md, row for row", () => {
	expect(specTable("**Calls.**")).toEqual(
		rules.map((rule) => [
			rule.event,
			String(rule.rank),
			rule.free,
			rule.busy,
			rule.held,
		]),
	);
});

test("askRules is the table in DESIGN.md, row for row", () => {
	expect(specTable("**Someone asks it to come.**")).toEqual(
		askRules.map((rule) => [rule.ask, rule.action, rule.says]),
	);
});

test("placeRules names are in DESIGN.md", () => {
	for (const name of new Set(placeRules.map(({ rule }) => rule)))
		expect(design).toContain(`\`${name}\``);
});

// Every row of the call table, in all three situations, through arbitrate.

const nowMs = 100 * 3600_000;
const now = at(nowMs);
/** `ms` before now. */
const ago = (ms: number): Temporal.Instant => at(nowMs - ms);
const eve = "macro|eve@example.com";
const ask = (over: Partial<Ask> = {}): Ask => ({
	id: "q",
	from: cy,
	name: "Cy",
	text: "prod is down",
	callId: "x",
	at: now,
	...over,
});
const asks = (
	open: readonly Ask[],
	over: {
		readonly moves?: readonly Temporal.Instant[];
		readonly weighed?: readonly (readonly [
			string,
			{ readonly count: number; readonly last: Temporal.Instant },
		])[];
	} = {},
): Asks => ({
	open,
	moves: over.moves ?? [],
	weighed: new Map(over.weighed ?? []),
});
const go = (current: string | null) => ({
	go: true,
	reason: "prod is down",
	need: "an outage",
	by: "model" as const,
	current,
});
const room = (over: Partial<WorldCall> = {}): WorldCall =>
	call({
		callId: "x",
		channelId: "ch-x",
		createdBy: cy,
		name: "eng",
		...over,
	});

/** What each row needs in the world, given the call the agent is in (if any). */
const rowWorlds: Readonly<
	Record<string, (current: string | null) => Partial<World>>
> = {
	"its own call": () => ({ calls: [room({ createdBy: assistant, dm: true })] }),
	"told to leave it": () => ({
		calls: [room({ dm: true })],
		hungUp: new Set(["x"]),
	}),
	"meeting without a token": () => ({
		meetings: [meeting({ callId: "x", token: null })],
	}),
	"owner's order": () => ({
		calls: [room()],
		asks: asks([ask({ from: owner, name: "Ada" })]),
	}),
	"owner calling": () => ({ calls: [room({ createdBy: owner, dm: true })] }),
	"request granted": (current) => ({
		calls: [room()],
		asks: asks([ask({ verdict: go(current) })]),
	}),
	"person calling": () => ({ calls: [room({ dm: true })] }),
	"allowlisted room": () => ({ calls: [room()], allowed: new Set(["ch-x"]) }),
	"placed call": () => ({ placed: [placed("x", { at: now })] }),
	"it chose to go": () => ({
		calls: [room()],
		judged: new Map([["x", { join: true, reason: "Drive" }]]),
	}),
	"any other live call": () => ({ calls: [room()] }),
};
const targetId = (world: Partial<World>): string =>
	(world.placed?.length ?? 0) > 0 ? "place-x" : "x";
const tellers = ["owner calling", "person calling", "allowlisted room"];

for (const rule of rules) {
	const situations: readonly (readonly [
		string,
		string | null,
		Cell,
		Partial<World>,
	])[] = [
		["free", null, rule.free, {}],
		["busy", "cy", rule.busy, { calls: [dm("cy", cy)] }],
		["held", "owner", rule.held, { calls: [dm("owner", owner)] }],
	];
	for (const [name, current, cell, extra] of situations) {
		test(`row "${rule.event}": ${name} -> ${cell}`, () => {
			const make = rowWorlds[rule.event];
			if (make === undefined) throw new Error(`no world for "${rule.event}"`);
			const row = make(current);
			const world = base({
				...row,
				...extra,
				calls: [...(row.calls ?? []), ...(extra.calls ?? [])],
			});
			const here = current === null ? [] : [inCall(current)];
			const plan = arbitrate(world, here, now, noTries, nobody);
			const id = targetId(row);
			expect(plan.join?.callId ?? null).toBe(cell === "join" ? id : null);
			expect(plan.leaving !== null).toBe(cell === "move");
			if (cell === "tell" && !tellers.includes(rule.event))
				throw new Error("nothing to tell");
			expect(plan.tell.map((notice) => notice.callId)).toEqual(
				cell === "tell" ? [id] : [],
			);
		});
	}
}

test("every decision comes with a row and an action, and what it is in reads stay", () => {
	const world = base({
		calls: [dm("cy", cy), dm("new", eve), call({ callId: "plain" })],
	});
	const { decisions } = arbitrate(world, [inCall("cy")], now, noTries, nobody);
	const of = (id: string): Decided | undefined =>
		decisions.find(({ callId }) => callId === id);
	expect(of("cy")).toMatchObject({ action: "stay", event: "person calling" });
	expect(of("new")).toMatchObject({ action: "tell", event: "person calling" });
	expect(of("plain")).toMatchObject({
		action: "skip",
		event: "any other live call",
	});
});

test("the log says who was seated: the others read wait or tell, not join", () => {
	const { decisions } = arbitrate(
		base({ calls: [dm("01a", cy), dm("01b", eve)] }),
		[],
		now,
		noTries,
		nobody,
	);
	expect(decisions.find(({ callId }) => callId === "01a")?.action).toBe("join");
	expect(decisions.find(({ callId }) => callId === "01b")?.action).toBe("tell");
	const backing = new Map<string, Tries>([
		["01a", { lastTry: ago(100), lastExit: ago(50), failures: 1 }],
	]);
	expect(
		arbitrate(base({ calls: [dm("01a", cy)] }), [], now, backing, nobody)
			.decisions[0]?.action,
	).toBe("wait");
});

// Requests: every row of the ask table.

const busyWorld = (over: Partial<World> = {}): World =>
	base({ calls: [dm("cy", eve), room()], ...over });
const onCy = [inCall("cy")];
const decideAsk = (world: World, here: readonly InCall[] = onCy): Plan =>
	arbitrate(world, here, now, noTries, nobody);

test("someone calling while it is busy is told once, and the line tells them they can ask", () => {
	const world = base({ calls: [dm("cy", eve), dm("new", cy)] });
	expect(decideAsk(world).tell).toEqual([
		{ callId: "new", to: { channel: "ch-new" }, text: busyLine },
	]);
	expect(busyLine).toContain("Need me sooner");
	expect(arbitrate(world, onCy, now, noTries, told("new")).tell).toEqual([]);
});

test("ask: a call that ended closes it, with no answer", () => {
	const plan = decideAsk(base({ calls: [dm("cy", eve)], asks: asks([ask()]) }));
	expect(plan.closeAsks).toMatchObject([{ why: "the call is over" }]);
	expect(plan.answers).toEqual([]);
});

test("the owner's ask is an order, in a line, with no model, and it moves the agent", () => {
	const plan = decideAsk(
		busyWorld({ asks: asks([ask({ from: owner, name: "Ada" })]) }),
	);
	expect(plan.weigh).toEqual([]);
	expect(plan.answers.map(({ line }) => line)).toEqual([comingLine]);
	expect(plan.leaving?.line).toBe(leaveLine.order);
	// It stands until the agent has served it.
	expect(plan.closeAsks).toEqual([]);
});

test("the owner's order, served and exited, stops pulling on the agent", () => {
	const tries = new Map<string, Tries>([
		["x", { lastTry: at(0), lastExit: at(10), failures: 0 }],
	]);
	const plan = arbitrate(
		busyWorld({ asks: asks([ask({ from: owner })]) }),
		onCy,
		now,
		tries,
		nobody,
	);
	expect(plan.leaving).toBeNull();
	expect(plan.closeAsks).toMatchObject([
		{ why: "the owner's, and it already served it" },
	]);
});

test("ask: it is already on that call", () => {
	const plan = decideAsk(busyWorld({ asks: asks([ask()]) }), [inCall("x")]);
	expect(plan.closeAsks).toMatchObject([{ why: "it is on that call" }]);
	expect(plan.answers).toEqual([]);
});

test("ask: free, someone asks and it comes", () => {
	const plan = arbitrate(
		base({ calls: [room()], asks: asks([ask()]) }),
		[],
		now,
		noTries,
		nobody,
	);
	expect(plan.answers.map(({ line }) => line)).toEqual([comingLine]);
	expect(plan.join).toMatchObject({ callId: "x", event: "request granted" });
	// Someone asked: normal greeting, normal recording.
	expect(plan.join?.uninvited).toBeUndefined();
});

test("on the owner's call, or an order: a refusal with no model", () => {
	const onOwner = decideAsk(
		busyWorld({ calls: [dm("owner", owner), room()], asks: asks([ask()]) }),
		[inCall("owner")],
	);
	expect(onOwner.weigh).toEqual([]);
	expect(onOwner.answers.map(({ line }) => line)).toEqual([stayLine]);
	const order = decideAsk(
		base({
			calls: [room({ callId: "o", channelId: "ch-o" }), room()],
			asks: asks([ask({ id: "e", from: owner, callId: "o" }), ask()]),
		}),
		[inCall("o")],
	);
	expect(order.answers.find((answer) => answer.ask.id === "q")?.line).toBe(
		stayLine,
	);
	expect(order.weigh).toEqual([]);
});

test("a request while busy goes to the model; nothing moves until it answers", () => {
	const plan = decideAsk(busyWorld({ asks: asks([ask()]) }));
	expect(plan.weigh.map(({ id }) => id)).toEqual(["q"]);
	expect(plan.leaving).toBeNull();
	expect(plan.answers).toEqual([]);
	const atModel = decideAsk(
		busyWorld({ asks: asks([ask()]), weighing: new Set(["q"]) }),
	);
	expect(atModel.weigh).toEqual([]);
});

test("the model says stay: one line, closed, it stays", () => {
	const plan = decideAsk(
		busyWorld({
			asks: asks([
				ask({
					verdict: {
						...go("cy"),
						go: false,
						reason: "its call matters more",
					},
				}),
			]),
		}),
	);
	expect(plan.answers.map(({ line }) => line)).toEqual([stayLine]);
	expect(plan.closeAsks).toMatchObject([{ why: "judged no on this call" }]);
	expect(plan.leaving).toBeNull();
});

test("the model says go: one line to the asker, and it says who and why out loud before leaving", () => {
	const plan = decideAsk(
		busyWorld({ asks: asks([ask({ verdict: go("cy") })]) }),
	);
	expect(plan.answers.map(({ line }) => line)).toEqual([comingLine]);
	expect(plan.leaving).toMatchObject({
		line: "Sorry, Cy needs my help with an outage. I've got to go.",
		ask: "q",
		callId: "cy",
	});
	// Only once it's out.
	expect(plan.join).toBeNull();
	// Answered once: the next tick it's still leaving and says nothing new to them.
	const again = decideAsk(
		busyWorld({ asks: asks([ask({ verdict: go("cy"), answered: true })]) }),
	);
	expect(again.answers).toEqual([]);
	expect(again.leaving).not.toBeNull();
});

test("a yes for the call it was on then is not a yes for this one: it goes back to the model", () => {
	const plan = decideAsk(
		busyWorld({ asks: asks([ask({ verdict: go("someone-else") })]) }),
	);
	expect(plan.leaving).toBeNull();
	expect(plan.weigh.map(({ id }) => id)).toEqual(["q"]);
});

test("no ping-pong: moved lately means no model and no move, however good the reason", () => {
	const recent = decideAsk(
		busyWorld({ asks: asks([ask()], { moves: [ago(moveGapMs - 1000)] }) }),
	);
	expect(recent.weigh).toEqual([]);
	expect(recent.answers.map(({ line }) => line)).toEqual([stayLine]);
	expect(recent.closeAsks).toMatchObject([{ why: "moved too recently" }]);
	const hour = Array.from({ length: maxMovesPerHour }, (_, index) =>
		ago(moveGapMs + 1000 + index * 60_000),
	);
	expect(
		decideAsk(busyWorld({ asks: asks([ask()], { moves: hour }) })).weigh,
	).toEqual([]);
	const old = [ago(moveGapMs + 1000)];
	expect(
		decideAsk(busyWorld({ asks: asks([ask()], { moves: old }) })).weigh,
	).toHaveLength(1);
});

test("insisting buys nothing: repeats within the gap wait, the newest stands, and there is a cap", () => {
	const twice = decideAsk(
		busyWorld({
			asks: asks([
				ask({ id: "a", text: "PLEASE", at: ago(1000) }),
				ask({ id: "b", text: "NOW!!!", at: now }),
			]),
		}),
	);
	expect(twice.weigh.map(({ id }) => id)).toEqual(["b"]);
	expect(twice.closeAsks).toMatchObject([
		{ ask: { id: "a" }, why: "superseded" },
	]);
	const soon = decideAsk(
		busyWorld({
			asks: asks([ask()], {
				weighed: [["x", { count: 1, last: ago(askGapMs - 1000) }]],
			}),
		}),
	);
	expect(soon.weigh).toEqual([]);
	expect(soon.answers).toEqual([]);
	const later = decideAsk(
		busyWorld({
			asks: asks([ask()], {
				weighed: [["x", { count: 1, last: ago(askGapMs + 1000) }]],
			}),
		}),
	);
	expect(later.weigh).toHaveLength(1);
	const capped = decideAsk(
		busyWorld({
			asks: asks([ask()], {
				weighed: [["x", { count: maxWeighs, last: at(0) }]],
			}),
		}),
	);
	expect(capped.weigh).toEqual([]);
	expect(capped.closeAsks).toMatchObject([{ why: "asked too many times" }]);
});

test("the owner goes before a granted request", () => {
	const plan = decideAsk(
		busyWorld({
			calls: [dm("cy", eve), dm("zz", owner), room()],
			asks: asks([ask({ verdict: go("cy") })]),
		}),
	);
	expect(plan.leaving?.line).toBe(leaveLine.owner);
});

// The mutex: every way a call can start, and the races.

const placedRow = (id: string, over: Partial<Placed> = {}): Placed =>
	placed(id, { at: now, ...over });

test("mutex: a placed call never joins while it is on a call, in flight, or leaving one", () => {
	const on = arbitrate(
		base({ calls: [dm("c", cy)], placed: [placedRow("a")] }),
		[inCall("c")],
		now,
		noTries,
		nobody,
	);
	expect(on.join).toBeNull();
	const flying = arbitrate(
		base({ placed: [placedRow("a"), placedRow("b")] }),
		[inPlaced("a")],
		now,
		noTries,
		nobody,
	);
	expect(flying.join).toBeNull();
	const unknown = arbitrate(
		base({ placed: [placedRow("a")] }),
		[{ pid: 9, callId: null, args: ["channel", "somewhere"] }],
		now,
		noTries,
		nobody,
	);
	expect(unknown.join).toBeNull();
	const leaving = arbitrate(
		base({ calls: [dm("c", cy), dm("e", owner)], placed: [placedRow("a")] }),
		[inCall("c")],
		now,
		noTries,
		nobody,
	);
	expect(leaving.join).toBeNull();
	expect(leaving.leaving).not.toBeNull();
});

test("mutex: two runs placing at once ring one at a time", () => {
	const world = base({
		placed: [placedRow("a"), placedRow("b", { target: dee })],
	});
	const first = arbitrate(world, [], now, noTries, nobody);
	expect(first.join?.callId).toBe("place-a");
	expect(
		arbitrate(world, [inPlaced("a")], now, noTries, nobody).join,
	).toBeNull();
});

test("mutex: someone calling while it dials is told, and no second join starts", () => {
	const plan = arbitrate(
		base({ calls: [dm("c", cy)], placed: [placedRow("a")] }),
		[inPlaced("a")],
		now,
		noTries,
		nobody,
	);
	expect(plan.join).toBeNull();
	expect(plan.leaving).toBeNull();
	expect(plan.tell.map((notice) => notice.callId)).toEqual(["c"]);
});

test("mutex: the owner calling while it dials pulls it out of it", () => {
	const dialing = arbitrate(
		base({ calls: [dm("e", owner)], placed: [placedRow("a")] }),
		[inPlaced("a")],
		now,
		noTries,
		nobody,
	);
	expect(dialing.leaving?.line).toBe(leaveLine.owner);
});

test("mutex: retries back off, stop after a few failures, and never ring again once it rang", () => {
	const tries = (failures: number) =>
		new Map<string, Tries>([
			["place-a", { lastTry: ago(100), lastExit: ago(50), failures }],
		]);
	expect(
		arbitrate(base({ placed: [placedRow("a")] }), [], now, tries(1), nobody)
			.join,
	).toBeNull();
	const gaveUp = arbitrate(
		base({ placed: [placedRow("a")] }),
		[],
		now,
		tries(maxPlaceFailures),
		nobody,
	);
	expect(gaveUp.join).toBeNull();
	expect(gaveUp.closePlaced).toMatchObject([
		{ id: "a", event: "expired", why: "join kept failing" },
	]);
	const rang = arbitrate(
		base({ placed: [placedRow("a", { joined: true })] }),
		[],
		now,
		noTries,
		nobody,
	);
	expect(rang.join).toBeNull();
	expect(rang.closePlaced).toMatchObject([
		{ id: "a", event: "ended", why: "rang, join gone" },
	]);
});

test("a blocked placed call waits, and goes stale at the TTL", () => {
	const stale = arbitrate(
		base({
			calls: [dm("c", cy)],
			placed: [placedRow("a", { at: ago(15 * 60_000) })],
		}),
		[inCall("c")],
		now,
		noTries,
		nobody,
	);
	expect(stale.closePlaced).toMatchObject([
		{ id: "a", event: "expired", why: "never got to it" },
	]);
	const wakes = arbitrate(
		base({ placed: [placedRow("a", { at: ago(60_000) })] }),
		[],
		now,
		noTries,
		nobody,
	);
	expect(wakes.join?.callId).toBe("place-a");
});

test("a call it placed is never taken for an inbound one", () => {
	// Macro lists it under the agent, even after it left and they stayed.
	const own = arbitrate(
		base({
			calls: [room({ channelId: "ch-a", createdBy: assistant, dm: true })],
		}),
		[],
		now,
		noTries,
		nobody,
	);
	expect(own.join).toBeNull();
	expect(own.decisions[0]).toMatchObject({
		event: "its own call",
		action: "skip",
	});
	// The room its dial landed in, whoever the list says made it: no busy line to the person it's calling.
	const landed = arbitrate(
		base({
			calls: [
				room({ callId: "real", channelId: "ch-a", createdBy: cy, dm: true }),
			],
			placed: [placedRow("a", { joined: true, callId: "real" })],
		}),
		[inPlaced("a")],
		now,
		noTries,
		nobody,
	);
	expect(landed.tell).toEqual([]);
	expect(landed.join).toBeNull();
	// They called in the same second it dialed: that's the same call, not someone waiting.
	const crossed = arbitrate(
		base({
			calls: [
				room({ callId: "theirs", channelId: "ch-a", createdBy: cy, dm: true }),
			],
			placed: [placedRow("a")],
		}),
		[inPlaced("a")],
		now,
		noTries,
		nobody,
	);
	expect(crossed.tell).toEqual([]);
	expect(crossed.leaving).toBeNull();
	// Free, and its placed call's room is still listed: it doesn't rejoin it as a caller.
	const left = arbitrate(
		base({
			calls: [
				room({
					callId: "real",
					channelId: "ch-a",
					createdBy: assistant,
					dm: true,
				}),
			],
		}),
		[],
		now,
		noTries,
		nobody,
	);
	expect(left.join).toBeNull();
});

test("a team channel call that rings nobody in particular reaches judgment, not a seat", () => {
	const world = base({
		calls: [
			call({ callId: "team", channelId: "ch", createdBy: cy, name: "team" }),
		],
	});
	expect(wanted(world)).toEqual([]);
	expect(pending(world).map(({ callId }) => callId)).toEqual(["team"]);
});

test("after a failed join the watcher retries the still-live call within about a second", () => {
	const failed: Tries = { lastTry: at(0), lastExit: at(46_000), failures: 1 };
	expect(joinDue(at(46_500), failed)).toBe(false);
	expect(joinDue(at(47_000), failed)).toBe(true);
	// The watcher sleeps until it's due, not the 3 s poll.
	expect(rejoinAt(failed)).toEqual(at(47_000));
	// Repeated failures back off, capped.
	expect(joinDue(at(46_000 + 3_999), { ...failed, failures: 3 })).toBe(false);
	expect(joinDue(at(46_000 + 4_000), { ...failed, failures: 3 })).toBe(true);
});

test("after a clean exit the watcher waits 15 s before rejoining a call that is still live", () => {
	const clean: Tries = { lastTry: at(0), lastExit: at(9_000), failures: 0 };
	expect(joinDue(at(10_000), clean)).toBe(false);
	expect(joinDue(at(15_000), clean)).toBe(true);
	expect(joinDue(at(0), undefined)).toBe(true);
	// Nothing to wake early for.
	expect(rejoinAt({ lastTry: at(0), failures: 0 })).toBeUndefined();
	expect(rejoinAt(clean)).toBeUndefined();
});

test("a rate limit holds the next join until it lifts, and a refused call is never retried", () => {
	const limited: Tries = {
		lastTry: at(0),
		lastExit: at(100),
		failures: 1,
		refusal: "rate_limited",
		refusals: 1,
		delayUntil: at(100 + rateLimitedMs),
	};
	expect(joinDue(at(100 + rateLimitedMs - 1), limited)).toBe(false);
	expect(joinDue(at(100 + rateLimitedMs), limited)).toBe(true);
	// The later of the backoff and the delay.
	expect(rejoinAt(limited)).toEqual(at(100 + rateLimitedMs));
	expect(rejoinAt({ ...limited, delayUntil: at(200) })).toEqual(at(1100));
	const refused: Tries = { ...limited, refusal: "refused" };
	expect(joinDue(at(nowMs), refused)).toBe(false);
	expect(rejoinAt(refused)).toBeUndefined();
});
