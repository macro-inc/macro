/**
 * Every decision about the agent's calls. Pure: the watcher hands it the world and
 * does what comes back. The rule tables below are the tables in DESIGN.md
 * ("The arbiter"), and the tests fail if they differ. A new rule is a row.
 *
 *   rules       a live call or queued placed call -> join, move, tell, wait, or skip
 *   askRules    someone asks it to come            -> order, go, refuse, weigh, wait, or close
 *   placeRules  someone wants a call placed        -> refuse, or queue it for `rules`
 *   judgeRules  a call nobody rang it for          -> stay out with a reason, or go to the model
 *
 * One call because Macro allows one: a token request removes the agent from
 * whatever it is in. So nothing joins while another join is alive, and every
 * join asks Macro to fail rather than switch (`onOtherCall: "fail"`), for the
 * joins this function never saw.
 */
import { after, elapsed, placePrefix } from "./config.ts";
import { rejoinDelay } from "./retry.ts";
import type {
	ActiveCall,
	ActiveMeeting,
	Ask,
	Asked,
	Asks,
	JoinArgs,
	Placed,
	PlaceEvent,
	PlaceRow,
	PlaceVerdict,
	Refusal,
} from "./types.ts";

const minute = 60_000;
const hour = 60 * minute;

/** Macro's web client rings for 30 s. */
export const ringMs = 40_000;
/** A placed call still waiting for the agent to be free after this is stale. */
export const placedTtlMs = 15 * minute;
/** A join that keeps failing doesn't ring someone for 15 minutes. */
export const maxPlaceFailures = 3;
export const maxPerHour = 1;
export const maxPerDay = 3;
/** After a clean exit, how soon the same live call may be joined again. */
export const retryMs = 15_000;
/** No ping-pong: a request can't move the agent again for this long. */
export const moveGapMs = 10 * minute;
export const maxMovesPerHour = 3;
/** Insisting doesn't buy another judgment sooner. */
export const askGapMs = 2 * minute;
/** Judgments per call. */
export const maxWeighs = 3;
/** After Macro says the agent is rate limited, how long before the next try. */
export const rateLimitedMs = 5 * minute;
const maxReason = 200;

// What the agent says. Fixed, not the model's: the asker never hears what the current call is about.
export const busyLine =
	"On another call. I'll jump in when I'm out, if you're still on. Need me sooner? Say why.";
const busyLineFor = (join: Join): string =>
	join.title === undefined || join.title === ""
		? busyLine
		: `On another call, so "${join.title}" waits. I'll jump in when I'm out, if it's still going.`;
export const comingLine = "Coming.";
export const stayLine =
	"Can't leave this one yet. I'll jump in when I'm out, if you're still on.";
export const leaveLine = {
	owner: "Sorry, I'm being called away. I've got to go.",
	order: "Sorry, I'm needed on another call. I've got to go.",
	request: (name: string, need: string): string =>
		need === ""
			? `Sorry, ${name} needs me on another call. I've got to go.`
			: `Sorry, ${name} needs my help with ${need}. I've got to go.`,
};

/** Where a line can be posted: a channel, or a DM with a person. */
export type Where = { readonly channel: string } | { readonly dm: string };
export type Notice = {
	readonly callId: string;
	readonly to: Where;
	readonly text: string;
};

export type Join = {
	readonly callId: string;
	readonly args: JoinArgs;
	readonly why: string;
	/** The row that seated this call. */
	readonly event: string;
	readonly rank: number;
	/** Nothing moves the agent out of this one. */
	readonly protects: boolean;
	/** It wants the agent now, whoever it's with. */
	readonly urgent: boolean;
	/** Where to reach whoever is waiting; null if nowhere safe. */
	readonly tellAt: Where | null;
	readonly title?: string;
	/** The agent chose to go; nobody asked. It says who it is, speaks when spoken to, and records no voices. */
	readonly uninvited?: boolean;
};

export type WorldCall = ActiveCall & {
	readonly ringing: boolean;
	readonly dm: boolean;
	/** The channel's name. Empty if it failed to load. */
	readonly name: string;
};

export type World = {
	readonly me: string;
	readonly owner: string;
	readonly calls: readonly WorldCall[];
	readonly meetings: readonly ActiveMeeting[];
	/** Channels whose calls the agent always joins. */
	readonly allowed: ReadonlySet<string>;
	/** Calls the agent was told to leave, or left uninvited. */
	readonly hungUp: ReadonlySet<string>;
	/** What the agent decided about calls with no standing claim on it. */
	readonly judged: ReadonlyMap<
		string,
		{ readonly join: boolean; readonly reason: string }
	>;
	/** Calls the agent was asked to place and hasn't finished. */
	readonly placed?: readonly Placed[];
	readonly asks?: Asks;
	/** Asks at the model right now. */
	readonly weighing?: ReadonlySet<string>;
};

/** A join process of the agent's: this watcher's (maybe still connecting), an earlier watcher's, or one started by hand. */
export type InCall = {
	readonly pid: number;
	readonly callId: string | null;
	readonly args: JoinArgs;
};

/** What the watcher remembers of its joins of one call. */
export type Tries = {
	readonly lastTry?: Temporal.Instant;
	readonly failures: number;
	readonly lastExit?: Temporal.Instant;
	readonly refusal?: Refusal;
	readonly refusals?: number;
	readonly delayUntil?: Temporal.Instant;
};

export const joinErrorRules: readonly {
	readonly refusal: Refusal;
	readonly next: string;
}[] = [
	{ refusal: "in_other_call", next: "retry, then switch" },
	{ refusal: "already_connected", next: "retry, then replace" },
	{ refusal: "ended", next: "close" },
	{ refusal: "rate_limited", next: "wait 5 minutes" },
	{ refusal: "refused", next: "close placed call" },
	{ refusal: "flag_off", next: "retry" },
];

/** How the next join of a call that Macro keeps refusing asks to be seated. */
export type Insist = {
	readonly onOtherCall?: "switch";
	readonly replace?: boolean;
};

/**
 * A process killed without leaving is a ghost: the agent stays "in" that call until
 * Macro's webhook clears it, and every other join is refused. After three of
 * the same refusal (at once for a call that moves it), the next join says
 * to switch, or to replace its dead connection.
 */
export const insist = (join: Join, tries: Tries | undefined): Insist => {
	if (tries?.refusal === undefined) return {};
	if ((tries.refusals ?? 0) < 3 && !join.urgent && !join.protects) return {};
	if (tries.refusal === "in_other_call") return { onOtherCall: "switch" };
	if (tries.refusal === "already_connected") return { replace: true };
	return {};
};

/** The agent was in this call and came out of it cleanly. */
const answered = (tries: Tries | undefined): boolean =>
	tries?.lastExit !== undefined && tries.failures === 0;

/**
 * When the watcher may (re)start a join for a call. After a failed join it
 * comes back within a second or two while the call is still live, so one
 * failed token request doesn't leave the caller with nobody; after a clean
 * exit, 15 s.
 */
export const joinDue = (
	now: Temporal.Instant,
	tries: Tries | undefined,
): boolean => {
	if (tries === undefined) return true;
	if (tries.refusal === "refused") return false;
	if (
		tries.delayUntil !== undefined &&
		Temporal.Instant.compare(now, tries.delayUntil) < 0
	)
		return false;
	if (tries.lastTry === undefined) return true;
	if (tries.failures > 0 && tries.lastExit !== undefined)
		return elapsed(now, tries.lastExit) >= rejoinDelay(tries.failures);
	return elapsed(now, tries.lastTry) >= retryMs;
};

// --- Calls: one row per kind of claim on the agent, first match wins. ---

/** What the rows look at: a live channel call, a meeting, or a queued placed call. */
export type Seen = {
	readonly callId: string;
	readonly args: JoinArgs;
	readonly createdBy: string;
	readonly name: string;
	readonly kind: "channel" | "meeting" | "placed";
	readonly ringing?: boolean;
	readonly dm?: boolean;
	readonly token?: string | null;
	readonly channelId?: string;
	readonly placed?: Placed;
};

type Facts = {
	readonly world: World;
	readonly tries: ReadonlyMap<string, Tries>;
	/** Calls the owner asked the agent onto. */
	readonly ordered: ReadonlySet<string>;
	/** Calls a request to come was granted for, with the ask. */
	readonly granted: ReadonlyMap<string, Ask>;
};

/** join: seat the agent. move: leave what it's in, saying why, then seat it. tell: told it's busy, once, and it waits. wait: waits, nobody told. skip: not its. */
export type Cell = "join" | "move" | "tell" | "wait" | "skip";

export type Rule = {
	readonly event: string;
	readonly rank: number;
	readonly free: Cell;
	readonly busy: Cell;
	readonly held: Cell;
	readonly when: (call: Seen, facts: Facts) => boolean;
	readonly protects?: (call: Seen, facts: Facts) => boolean;
	/** What the agent says to the people it's leaving for this call. */
	readonly line?: (call: Seen, facts: Facts) => string;
};

const allowlisted = (call: Seen, { world }: Facts): boolean =>
	call.kind === "channel" &&
	call.channelId !== undefined &&
	world.allowed.has(call.channelId);

const ownerStanding = (call: Seen, facts: Facts): boolean =>
	call.createdBy === facts.world.owner &&
	(call.ringing === true ||
		call.dm === true ||
		call.kind === "meeting" ||
		allowlisted(call, facts));

const yes = (): boolean => true;
const owners = (call: Seen, { world }: Facts): boolean =>
	call.createdBy === world.owner;

const skipped = { rank: 9, free: "skip", busy: "skip", held: "skip" } as const;

export const rules: readonly Rule[] = [
	{
		event: "its own call",
		...skipped,
		// A call it placed can't look inbound: anything it made, or whose room the ledger says its dial landed in.
		when: (call, { world }) =>
			call.kind !== "placed" &&
			(call.createdBy === world.me ||
				(world.placed ?? []).some(({ callId }) => callId === call.callId)),
	},
	{
		event: "told to leave it",
		...skipped,
		when: (call, { world }) => world.hungUp.has(call.callId),
	},
	{
		event: "meeting without a token",
		...skipped,
		when: (call) => call.kind === "meeting" && (call.token ?? "") === "",
	},
	{
		event: "owner's order",
		rank: 0,
		free: "join",
		busy: "move",
		held: "wait",
		protects: yes,
		line: () => leaveLine.order,
		when: (call, { ordered }) => ordered.has(call.callId),
	},
	{
		event: "owner calling",
		rank: 0,
		free: "join",
		busy: "move",
		held: "tell",
		protects: yes,
		line: () => leaveLine.owner,
		// One it hasn't answered: after a clean exit that call is a "person calling", or a ghost of it would pull it out forever.
		when: (call, facts) =>
			ownerStanding(call, facts) && !answered(facts.tries.get(call.callId)),
	},
	{
		event: "request granted",
		rank: 1,
		free: "join",
		busy: "move",
		held: "wait",
		line: (call, { granted }) => {
			const ask = granted.get(call.callId);
			return leaveLine.request(
				ask?.name ?? "Someone",
				ask?.verdict?.need ?? "",
			);
		},
		when: (call, { granted }) => granted.has(call.callId),
	},
	{
		event: "person calling",
		rank: 1,
		free: "join",
		busy: "tell",
		held: "tell",
		protects: owners,
		when: (call, { world }) =>
			call.ringing === true ||
			call.dm === true ||
			(call.kind === "meeting" && call.createdBy === world.owner),
	},
	{
		event: "allowlisted room",
		rank: 2,
		free: "join",
		busy: "tell",
		held: "tell",
		protects: owners,
		when: allowlisted,
	},
	{
		event: "placed call",
		rank: 1,
		free: "join",
		busy: "wait",
		held: "wait",
		when: (call) => call.kind === "placed",
	},
	{
		event: "it chose to go",
		rank: 2,
		free: "join",
		busy: "wait",
		held: "wait",
		when: (call, { world }) =>
			world.judged.get(call.callId)?.join === true &&
			(call.kind === "meeting" || call.name !== ""),
	},
	{ event: "any other live call", ...skipped, when: yes },
];

const lastRule = (): Rule => {
	const last = rules.at(-1);
	if (last === undefined) throw new Error("rules has no last row");
	return last;
};

const seen = (world: World): readonly Seen[] => [
	...world.calls.map(
		(call): Seen => ({
			callId: call.callId,
			args: ["channel", call.channelId],
			createdBy: call.createdBy,
			name: call.name,
			kind: "channel",
			ringing: call.ringing,
			dm: call.dm,
			channelId: call.channelId,
		}),
	),
	...world.meetings.map(
		(meeting): Seen => ({
			callId: meeting.callId,
			args: ["meeting", meeting.token ?? ""],
			createdBy: meeting.createdBy,
			name: meeting.title,
			kind: "meeting",
			token: meeting.token,
		}),
	),
	...(world.placed ?? []).map(
		(placed): Seen => ({
			callId: `${placePrefix}${placed.id}`,
			args: ["channel", placed.channelId],
			createdBy: world.me,
			name: "placed",
			kind: "placed",
			placed,
		}),
	),
];

const ruleFor = (call: Seen, facts: Facts): Rule =>
	rules.find((rule) => rule.when(call, facts)) ?? lastRule();

const chose = "it chose to go";

const toJoin = (call: Seen, rule: Rule, facts: Facts): Join => {
	const { world, ordered, granted } = facts;
	const decided = world.judged.get(call.callId)?.reason;
	const why =
		call.kind === "placed"
			? `placed: ${call.placed?.rule ?? ""}`
			: rule.event === chose
				? call.kind === "meeting"
					? `meeting "${call.name}", decided: ${decided}`
					: `decided: ${decided}`
				: ordered.has(call.callId) || granted.has(call.callId)
					? rule.event
					: call.kind === "meeting"
						? `meeting "${call.name}"`
						: call.ringing === true
							? "ringing"
							: call.dm === true
								? "dm"
								: "allowlisted";
	// Nobody asked for a call it chose, so nobody there is told anything. A
	// meeting has no channel: the owner waiting gets a DM, nobody else anything.
	const tellAt: Where | null =
		call.kind === "channel" && call.channelId !== undefined
			? rule.event === chose
				? null
				: { channel: call.channelId }
			: call.kind === "meeting" && call.createdBy === world.owner
				? { dm: call.createdBy }
				: null;
	return {
		callId: call.callId,
		args: call.args,
		why,
		event: rule.event,
		rank: rule.rank,
		protects: rule.protects?.(call, facts) === true,
		urgent: rule.busy === "move",
		tellAt,
		...(call.kind === "meeting" ? { title: call.name } : {}),
		...(rule.event === chose && call.kind === "channel"
			? { uninvited: true }
			: {}),
	};
};

type Claim = {
	readonly join: Join;
	readonly rule: Rule;
	readonly seen: Seen;
};

/** Every call that wants the agent right now, and the row each came under. */
const claims = (facts: Facts): readonly Claim[] =>
	seen(facts.world).flatMap((call) => {
		const rule = ruleFor(call, facts);
		return rule.free === "skip"
			? []
			: [{ join: toJoin(call, rule, facts), rule, seen: call }];
	});

/** Every call that wants the agent right now. `arbitrate` picks at most one. */
export const wanted = (world: World): readonly Join[] =>
	claims({
		world,
		tries: new Map(),
		ordered: new Set(),
		granted: new Map(),
	}).map(({ join }) => join);

/** The same call: a placed call answered by the room it rang, or a join started by hand. */
const sameCall = (
	call: { readonly callId: string | null; readonly args: JoinArgs },
	join: InCall,
): boolean =>
	call.callId === join.callId ||
	(call.args[0] === join.args[0] && call.args[1] === join.args[1]);

// --- Asks: someone wants the agent on their call. First match wins. ---

/** order: the owner's, no weighing. go: it's coming. refuse: answered and closed. weigh: one model call. wait: nothing yet. close: closed, no answer. */
export type AskAction = "order" | "go" | "refuse" | "weigh" | "wait" | "close";

type AskFacts = {
	readonly world: World;
	readonly tries: ReadonlyMap<string, Tries>;
	readonly now: Temporal.Instant;
	readonly free: boolean;
	readonly held: boolean;
	readonly current: InCall | null;
	/** The live call the ask is for, if it is still live. */
	readonly target: Seen | undefined;
	readonly weighed?: {
		readonly count: number;
		readonly last: Temporal.Instant;
	};
	readonly moves: readonly Temporal.Instant[];
};

export type AskRule = {
	readonly ask: string;
	readonly action: AskAction;
	/** The table's column: what the agent answers, in a word. */
	readonly says: string;
	/** What the agent actually posts back. */
	readonly line?: string;
	readonly when: (ask: Ask, facts: AskFacts) => boolean;
};

const inTarget = ({ target, current }: AskFacts): boolean =>
	target !== undefined && current !== null && sameCall(target, current);

const movedLately = ({ moves, now }: AskFacts): boolean =>
	moves.some((at) => elapsed(now, at) < moveGapMs) ||
	moves.filter((at) => elapsed(now, at) < hour).length >= maxMovesPerHour;

/** A verdict is good only for the call the agent was on when it was made. */
const weighedNow = (ask: Ask, { current }: AskFacts): boolean =>
	ask.verdict !== undefined &&
	ask.verdict.current === (current?.callId ?? null);

export const askRules: readonly AskRule[] = [
	{
		ask: "the call is over",
		action: "close",
		says: "-",
		when: (_, { target }) => target === undefined,
	},
	{
		ask: "the owner's, and it already served it",
		action: "close",
		says: "-",
		when: (ask, { world, tries }) =>
			ask.from === world.owner && answered(tries.get(ask.callId)),
	},
	{
		ask: "the owner's",
		action: "order",
		says: "Coming",
		line: comingLine,
		when: (ask, { world }) => ask.from === world.owner,
	},
	{
		ask: "it is on that call",
		action: "close",
		says: "-",
		when: (_, facts) => inTarget(facts),
	},
	{
		ask: "it is free",
		action: "go",
		says: "Coming",
		line: comingLine,
		when: (_, { free }) => free,
	},
	{
		ask: "it is on the owner's call, or an order",
		action: "refuse",
		says: "Can't leave",
		line: stayLine,
		when: (_, { held }) => held,
	},
	{
		ask: "judged yes on this call",
		action: "go",
		says: "Coming",
		line: comingLine,
		when: (ask, facts) => weighedNow(ask, facts) && ask.verdict?.go === true,
	},
	{
		ask: "judged no on this call",
		action: "refuse",
		says: "Can't leave",
		line: stayLine,
		when: (ask, facts) => weighedNow(ask, facts) && ask.verdict?.go === false,
	},
	{
		ask: "moved too recently",
		action: "refuse",
		says: "Can't leave",
		line: stayLine,
		when: (_, facts) => movedLately(facts),
	},
	{
		ask: "asked too many times",
		action: "refuse",
		says: "Can't leave",
		line: stayLine,
		when: (_, { weighed }) => (weighed?.count ?? 0) >= maxWeighs,
	},
	{
		ask: "at the model, or asked again too soon",
		action: "wait",
		says: "-",
		when: (ask, { world, weighed, now }) =>
			world.weighing?.has(ask.id) === true ||
			(weighed !== undefined && elapsed(now, weighed.last) < askGapMs),
	},
	{ ask: "anything else", action: "weigh", says: "depends", when: yes },
];

/** The newest open ask per person and call stands; the rest are superseded. */
export const supersededAsks = (
	open: readonly Ask[],
): { readonly keep: readonly Ask[]; readonly drop: readonly Ask[] } => {
	const newest = new Map<string, Ask>();
	for (const ask of open) {
		const key = `${ask.from}|${ask.callId}`;
		const other = newest.get(key);
		if (other === undefined || Temporal.Instant.compare(ask.at, other.at) >= 0)
			newest.set(key, ask);
	}
	const keep = [...newest.values()];
	return { keep, drop: open.filter((ask) => !keep.includes(ask)) };
};

// --- The decision. ---

export type Decided = {
	readonly callId: string | null;
	readonly event: string;
	readonly action: string;
	readonly why: string;
};

export type Leaving = {
	readonly joins: readonly InCall[];
	/** What the agent says out loud before it goes. */
	readonly line: string;
	/** The call it's leaving, and where its people can be reached if the line wasn't heard. */
	readonly callId: string | null;
	readonly to: Where | null;
	/** The ask that moved the agent, if one did. */
	readonly ask: string | null;
};

export type PlacedClose = {
	readonly id: string;
	readonly event: PlaceEvent;
	readonly why: string;
	readonly placed: Placed;
};

export type Plan = {
	readonly join: Join | null;
	/** Stop these first, saying the line; the join comes on a later tick, once they're gone. */
	readonly leaving: Leaving | null;
	readonly tell: readonly Notice[];
	/** The call the agent is in, if anything claims it. */
	readonly current: Join | null;
	readonly answers: readonly { readonly ask: Ask; readonly line: string }[];
	readonly closeAsks: readonly { readonly ask: Ask; readonly why: string }[];
	readonly weigh: readonly Ask[];
	readonly closePlaced: readonly PlacedClose[];
	/** Every decision this tick, with its reason. The watcher logs the ones that changed. */
	readonly decisions: readonly Decided[];
};

const before = (
	a: Temporal.Instant | undefined,
	b: Temporal.Instant | undefined,
): number =>
	a === undefined
		? b === undefined
			? 0
			: -1
		: b === undefined
			? 1
			: Temporal.Instant.compare(a, b);

/**
 * What the agent does this tick. Pure. It stays in the call it's in; a row
 * with `move` in its busy column moves it, and only if the call it's in
 * doesn't protect it. Callers it can't take are told once, and it takes them
 * when it's free. Call ids are UUIDv7, so sorting them is first come, first served.
 */
export const arbitrate = (
	world0: World,
	inCall: readonly InCall[],
	now: Temporal.Instant,
	tries: ReadonlyMap<string, Tries>,
	told: (callId: string) => boolean,
): Plan => {
	const swept = sweepPlaced(
		world0.placed ?? [],
		world0.calls,
		world0.me,
		(id) => inCall.some(({ callId }) => callId === id),
		now,
		tries,
	);
	const world: World = { ...world0, placed: swept.live };
	const decisions: Decided[] = swept.close.map((close) => ({
		callId: `${placePrefix}${close.id}`,
		event: "placed call",
		action: close.event,
		why: close.why,
	}));
	const asks = supersededAsks(world.asks?.open ?? []);
	const closeAsks: { readonly ask: Ask; readonly why: string }[] =
		asks.drop.map((ask) => ({ ask, why: "superseded" }));

	// The owner's asks need no judging, so the protection of the call it's in can be read first.
	const live = seen(world);
	const ordered = new Set(
		asks.keep
			.filter(
				(ask) => ask.from === world.owner && !answered(tries.get(ask.callId)),
			)
			.map(({ callId }) => callId),
	);
	const on = (claim: Claim): boolean =>
		inCall.some((join) => sameCall(claim.join, join));
	const here = claims({ world, tries, ordered, granted: new Map() }).find(on);
	const held = here?.join.protects === true;
	const current = inCall[0] ?? null;
	const free = inCall.length === 0;

	const answers: { readonly ask: Ask; readonly line: string }[] = [];
	const weigh: Ask[] = [];
	const granted = new Map<string, Ask>();
	for (const ask of asks.keep) {
		const facts: AskFacts = {
			world,
			tries,
			now,
			free,
			held,
			current,
			target: live.find(({ callId }) => callId === ask.callId),
			weighed: world.asks?.weighed.get(ask.callId),
			moves: world.asks?.moves ?? [],
		};
		const rule = askRules.find(({ when }) => when(ask, facts));
		if (rule === undefined) throw new Error("askRules has no last row");
		decisions.push({
			callId: ask.callId,
			event: `ask from ${ask.from}: ${rule.ask}`,
			action: rule.action,
			why: ask.verdict?.reason ?? ask.text.slice(0, 200),
		});
		if (rule.line !== undefined && ask.answered !== true)
			answers.push({ ask, line: rule.line });
		if (rule.action === "go") granted.set(ask.callId, ask);
		if (rule.action === "weigh") weigh.push(ask);
		if (rule.action === "close" || rule.action === "refuse")
			closeAsks.push({ ask, why: rule.ask });
	}

	const facts: Facts = { world, tries, ordered, granted };
	// Whoever has waited longest for the agent goes first among equals.
	const lastTry = (join: Join) => tries.get(join.callId)?.lastTry;
	const want = [...claims(facts)].sort(
		(a, b) =>
			a.join.rank - b.join.rank ||
			before(lastTry(a.join), lastTry(b.join)) ||
			(a.join.callId < b.join.callId ? -1 : 1),
	);
	const mine = want.find(on);
	const waiting = want.filter((claim) => !on(claim));
	const situation = free ? "free" : held ? "held" : "busy";
	const due = (claim: Claim) => joinDue(now, tries.get(claim.join.callId));

	// The call it's headed for, which doesn't need telling.
	const moving = free || held ? undefined : waiting.find((c) => c.join.urgent);
	// A failed join of the owner's is back within seconds: keep the slot rather than seat someone just to throw them out.
	const holding = free
		? waiting.find((claim) => claim.join.urgent && !due(claim))
		: undefined;
	const next = free ? (holding ?? waiting.find(due)) : moving;
	const join = free && holding === undefined ? (next?.join ?? null) : null;
	const leaving: Leaving | null =
		moving === undefined
			? null
			: {
					joins: inCall,
					line: moving.rule.line?.(moving.seen, facts) ?? "",
					callId: mine?.join.callId ?? null,
					to: mine?.join.tellAt ?? null,
					ask: granted.get(moving.join.callId)?.id ?? null,
				};

	const tell: Notice[] = [];
	if (!free || next !== undefined)
		for (const claim of waiting) {
			if (claim === next) continue;
			// A move that didn't go first still waits, so they hear it too.
			const cell = held ? claim.rule.held : claim.rule.busy;
			if (
				(cell === "tell" || cell === "move") &&
				claim.join.tellAt !== null &&
				!told(claim.join.callId)
			)
				tell.push({
					callId: claim.join.callId,
					to: claim.join.tellAt,
					text: busyLineFor(claim.join),
				});
		}
	if (leaving !== null && moving !== undefined)
		decisions.push({
			callId: leaving.callId,
			event: `leaving for ${moving.join.callId}: ${moving.rule.event}`,
			action: "leave",
			why: leaving.line,
		});

	// Why, for the log: every seen call, whatever became of it.
	for (const call of live) {
		const rule = ruleFor(call, facts);
		const onIt = inCall.some((j) => sameCall(call, j));
		const cell = rule[situation];
		const action = onIt
			? "stay"
			: call.callId === join?.callId
				? "join"
				: call.callId === next?.join.callId
					? leaving !== null
						? "leave"
						: "wait"
					: next !== undefined
						? rule.busy
						: // Seated elsewhere, or not due yet.
							cell === "join"
							? "wait"
							: cell;
		decisions.push({
			callId: call.callId,
			event: rule.event,
			action,
			why: onIt ? "in it" : rule.event,
		});
	}
	return {
		join,
		leaving,
		tell,
		current: mine?.join ?? null,
		answers,
		closeAsks,
		weigh,
		closePlaced: swept.close,
		decisions,
	};
};

// --- Placed calls. ---

/**
 * The watcher's upkeep of placed calls. Pure. A request the agent isn't in
 * any more ends once it rang, when it's gone stale, when its join keeps
 * failing, or when someone already started a call in that channel (the agent
 * takes that one anyway, and a second ring would be noise).
 */
export const sweepPlaced = (
	pending: readonly Placed[],
	calls: readonly { readonly channelId: string; readonly createdBy: string }[],
	me: string,
	inCall: (id: string) => boolean,
	now: Temporal.Instant,
	tries: ReadonlyMap<string, Tries> = new Map(),
): {
	readonly live: readonly Placed[];
	readonly close: readonly PlacedClose[];
} => {
	const live: Placed[] = [];
	const close: PlacedClose[] = [];
	for (const placed of pending) {
		const key = `${placePrefix}${placed.id}`;
		const tried = tries.get(key);
		const end = (event: PlaceEvent, why: string) =>
			close.push({ id: placed.id, event, why, placed });
		if (inCall(key)) live.push(placed);
		else if (placed.answered === true) end("ended", "answered, join gone");
		// Retrying would ring them again.
		else if (placed.joined === true) end("ended", "rang, join gone");
		else if (
			calls.some(
				(call) => call.channelId === placed.channelId && call.createdBy !== me,
			)
		)
			end("ended", "they started a call first");
		else if (tried?.refusal === "rate_limited" || tried?.refusal === "refused")
			end("ended", `join ${tried.refusal}`);
		else if ((tried?.failures ?? 0) >= maxPlaceFailures)
			end("expired", "join kept failing");
		else if (elapsed(now, placed.at) >= placedTtlMs)
			end("expired", "never got to it");
		else live.push(placed);
	}
	return { live, close };
};

export type Target =
	| { readonly kind: "user"; readonly id: string }
	| {
			readonly kind: "channel";
			readonly id: string;
			readonly name: string;
			readonly members: readonly string[];
	  };

export type PlaceRequest = {
	readonly asked: Asked | null;
	readonly target: Target;
	readonly reason: string;
};

export type PlaceContext = {
	readonly me: string;
	readonly owner: string;
	readonly now: Temporal.Instant;
	readonly rows: readonly PlaceRow[];
	readonly noCall: ReadonlySet<string>;
};

export const finished = (event: PlaceEvent): boolean =>
	event === "no_answer" || event === "ended" || event === "expired";

const queuedFor = (
	{ target }: PlaceRequest,
	{ rows, now }: PlaceContext,
	within: number,
): readonly PlaceRow[] =>
	rows.filter(
		(row) =>
			row.event === "queued" &&
			row.target === target.id &&
			elapsed(now, row.at) < within,
	);

export type PlaceRule = {
	readonly rule: string;
	/** Why it's refused, or false. */
	readonly no?: (
		request: PlaceRequest,
		context: PlaceContext,
	) => string | false;
	/** Whether it's allowed under this rule. */
	readonly ok?: (request: PlaceRequest, context: PlaceContext) => boolean;
};

/** Each row: a refusal, if `no` returns why; or the rule it's allowed under, if `ok`. First match wins. */
export const placeRules: readonly PlaceRule[] = [
	{
		rule: "reason",
		no: ({ reason }) =>
			(reason.trim() === "" ||
				reason.length > maxReason ||
				/\n/.test(reason.trim())) &&
			`The reason must be one line under ${maxReason} characters: it's what the call opens with.`,
	},
	{
		rule: "self",
		no: ({ target }, { me }) =>
			target.kind === "user" && target.id === me && "It can't call itself.",
	},
	{
		rule: "members",
		no: ({ target }, { me }) =>
			target.kind === "channel" &&
			target.members.every((member) => member === me) &&
			"That channel's members failed to load, or nobody else is in it.",
	},
	{
		rule: "no-call",
		no: ({ target }, { noCall }) =>
			target.kind === "user" &&
			noCall.has(target.id) &&
			`${target.id} said not to be called.`,
	},
	{
		rule: "no-call",
		no: ({ target }, { noCall, me }) =>
			target.kind === "channel" &&
			target.members.some((member) => member !== me && noCall.has(member)) &&
			"Someone in that channel said not to be called.",
	},
	{
		rule: "already",
		no: (request, context) =>
			queuedFor(request, context, placedTtlMs).some(
				(queued) =>
					!context.rows.some(
						(row) => row.id === queued.id && finished(row.event),
					),
			) && "Already calling them.",
	},
	{
		rule: "self",
		no: ({ asked }, { me }) =>
			asked?.id === me && "Its own message isn't a request.",
	},
	{
		rule: "owner-order",
		ok: ({ asked }, { owner }) => asked?.id === owner && asked.sure,
	},
	{
		rule: "nobody-asked",
		no: ({ asked }) => asked === null && "Nobody asked for this call.",
	},
	{
		rule: "channel",
		no: ({ target }) =>
			target.kind === "channel" &&
			"Calling a whole channel takes the owner's order: it rings everyone.",
	},
	{
		rule: "third-party",
		no: ({ target, asked }) =>
			target.id !== asked?.id &&
			"Calling someone other than the asker takes the owner's order.",
	},
	{
		rule: "limit",
		no: (request, context) =>
			queuedFor(request, context, hour).length >= maxPerHour &&
			`${request.target.id} was already called in the last hour.`,
	},
	{
		rule: "limit",
		no: (request, context) =>
			queuedFor(request, context, 24 * hour).length >= maxPerDay &&
			`${request.target.id} was already called ${maxPerDay} times today.`,
	},
	{ rule: "call-back", ok: yes },
];

/**
 * May the agent place this call? Pure. The owner's order places it, to
 * anyone. Anyone else may only ask to be called back themselves, within
 * limits, so the agent can't be used to ring a third person or harass
 * someone. Who asked is never a claim in words: see `PlaceInput`. A call
 * this allows is queued: `rules` seats it, so it never rings while the agent
 * is on a call or another join is in flight.
 */
export const mayPlace = (
	request: PlaceRequest,
	context: PlaceContext,
): PlaceVerdict => {
	for (const row of placeRules) {
		const why = row.no?.(request, context);
		if (typeof why === "string") return { ok: false, rule: row.rule, why };
		if (row.ok?.(request, context) === true)
			return { ok: true, rule: row.rule };
	}
	throw new Error("placeRules has no last row");
};

// --- Calls nobody rang the agent for. The model is judge.ts; which ones reach it is here. ---

export type Pending =
	| {
			readonly kind: "channel";
			readonly callId: string;
			readonly channelId: string;
			readonly channel: string;
			readonly createdBy: string;
			readonly createdAt?: string;
			readonly count?: number;
	  }
	| {
			readonly kind: "invite";
			readonly callId: string;
			readonly token: string;
			readonly title: string;
			readonly createdBy: string;
	  };

/** Live calls with no standing claim on the agent: not ringing it, not its DM, not an allowlisted room, not the owner's invite. */
export const pending = (world: World): readonly Pending[] => [
	...world.calls.flatMap((call): Pending[] =>
		call.createdBy === world.me ||
		world.hungUp.has(call.callId) ||
		call.ringing ||
		call.dm ||
		world.allowed.has(call.channelId)
			? []
			: [
					{
						kind: "channel",
						callId: call.callId,
						channelId: call.channelId,
						channel: call.name,
						createdBy: call.createdBy,
						createdAt: call.createdAt,
						count: call.participantCount,
					},
				],
	),
	...world.meetings.flatMap((meeting): Pending[] =>
		meeting.createdBy === world.me ||
		meeting.createdBy === world.owner ||
		world.hungUp.has(meeting.callId) ||
		meeting.token === null ||
		meeting.token === ""
			? []
			: [
					{
						kind: "invite",
						callId: meeting.callId,
						token: meeting.token,
						title: meeting.title,
						createdBy: meeting.createdBy,
					},
				],
	),
];

export const judgeRules: readonly {
	readonly key: string;
	readonly reason: string;
	readonly when: (call: Pending, busy: boolean) => boolean;
}[] = [{ key: "busy", reason: "on another call", when: (_, busy) => busy }];

/** The answers that need neither the channel nor a model. */
export const ruleOut = (
	call: Pending,
	busy: boolean,
): { readonly key: string; readonly reason: string } | null => {
	const rule = judgeRules.find(({ when }) => when(call, busy));
	return rule === undefined ? null : { key: rule.key, reason: rule.reason };
};

/** The wait before the next join of a call, for the watcher's sleep. Undefined if nothing is due. */
export const rejoinAt = (tries: Tries): Temporal.Instant | undefined => {
	if (
		tries.failures === 0 ||
		tries.lastExit === undefined ||
		tries.refusal === "refused"
	)
		return undefined;
	const retry = after(tries.lastExit, rejoinDelay(tries.failures));
	return tries.delayUntil !== undefined &&
		Temporal.Instant.compare(tries.delayUntil, retry) > 0
		? tries.delayUntil
		: retry;
};
