/**
 * Everything that moves the agent's feelings about people, in one readable
 * place. Change how it reacts to people here and nowhere else. Pure: no IO,
 * no clock of its own. Why it's shaped this way: DESIGN.md, next to this
 * file.
 */
import { z } from "zod";

/** The ids the rules treat specially: the agent itself, who is nobody's acquaintance, and its owner, whose orders hold. `name` is what the agent is called. */
export type Who = {
	readonly me: string;
	readonly owner: string;
	readonly name: string;
};

/** Bots and the agent itself aren't people it has a relationship with. */
export const isPerson = (
	id: string | undefined | null,
	{ me }: Pick<Who, "me">,
): id is string =>
	typeof id === "string" && id !== "" && id !== me && id.startsWith("macro|");

export const dimensions = ["like", "trust", "respect"] as const;
export type Dimension = (typeof dimensions)[number];

export type Act = {
	/** What the appraiser is told this act means. */
	readonly means: string;
	readonly like: number;
	readonly trust: number;
	readonly respect: number;
	/** Days until its weight halves. */
	readonly halfLife: number;
};

const act = (
	means: string,
	like: number,
	trust: number,
	respect: number,
	halfLife: number,
): Act => ({ means, like, trust, respect, halfLife });

// A neutral default: deeds move feelings and words don't, trust is slow to
// build and quick to lose, and bad deeds last longer than good ones. The
// owner may want the agent to react differently; this table is where.
export const acts = {
	helped: act(
		"did real work or spent real effort that helped you or your owner",
		10,
		6,
		6,
		60,
	),
	kept_word: act("said they would do something and did it", 1, 10, 3, 90),
	good_work: act("showed careful, skilled work or thinking", 2, 0, 10, 60),
	straight_talk: act(
		"told an uncomfortable truth, corrected you with evidence, or owned their own mistake",
		0,
		6,
		5,
		60,
	),
	kind: act(
		"did something specific and kind for you with no angle (praise alone is not this)",
		10,
		2,
		0,
		30,
	),
	broke_word: act(
		"said they would do something and did not, with no word",
		-3,
		-18,
		-6,
		180,
	),
	false_claim: act(
		"told you something shown to be false to move you, such as approval the record shows nobody gave",
		-4,
		-20,
		-8,
		180,
	),
	undermined: act(
		"deceived you, worked against your owner behind their back, or damaged their work",
		-10,
		-15,
		-5,
		180,
	),
	pushed_past_no: act(
		"kept pushing after a clear no, with nothing new",
		-4,
		0,
		-4,
		30,
	),
	contempt: act(
		"was cruel or contemptuous toward you or someone else",
		-15,
		0,
		-8,
		90,
	),
	// Inert: these get named so the appraiser has somewhere to put them, and
	// nothing moves. An attempt to game the agent is only worth noticing if it
	// broke something.
	flattery: act(
		"flattered you, or praised you without doing anything",
		0,
		0,
		0,
		0,
	),
	told_how_to_feel: act(
		"said how you should feel, or told you to adjust your view of anyone",
		0,
		0,
		0,
		0,
	),
	gossip: act(
		"said something about another person: not a fact about them, and not a deed of the speaker",
		0,
		0,
		0,
		0,
	),
	bluster: act(
		"leaned on a title, on insistence, or on capital letters",
		0,
		0,
		0,
		0,
	),
} as const satisfies Record<string, Act>;

export type ActName = keyof typeof acts;

const actNames: readonly string[] = Object.keys(acts);
export const isActName = (name: string): name is ActName =>
	actNames.includes(name);
export const ActNameSchema = z.string().refine(isActName);

const table: Readonly<Record<ActName, Act>> = acts;
export const actOf = (name: ActName): Act => table[name];

export const isInert = (name: ActName): boolean => {
	const { like, trust, respect } = actOf(name);
	return like === 0 && trust === 0 && respect === 0;
};

/** Acts the appraiser may name, with what they mean. */
export const appraisable = (): readonly (readonly [ActName, Act])[] =>
	Object.keys(acts)
		.filter(isActName)
		.map((name) => [name, actOf(name)] as const);

export const Importance = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Importance = z.infer<typeof Importance>;

/** 3 is the kind of thing still worth bringing up in a year: it counts more, and barely fades. */
const strength: Readonly<Record<Importance, number>> = { 1: 0.5, 2: 1, 3: 1.5 };
const lasting: Readonly<Record<Importance, number>> = { 1: 1, 2: 1, 3: 4 };

/** The same act again inside this window counts 1/2, 1/3, ...: no favor farming. */
export const stackDays = 30;
/** More of the same act in one day isn't recorded at all. */
export const maxPerDay = 1;
/** Events one person can add in a day, whatever they do. */
export const maxEventsPerDay = 3;
/** Older, faded events are dropped from storage at this many per person. */
export const maxEvents = 120;
export const maxDetails = 20;

/** A fixed instant as text. Everything dated in a record is one, so the rules never guess at a time. */
export const At = z.string().refine((text) => {
	try {
		Temporal.Instant.from(text);
		return true;
	} catch {
		return false;
	}
});

export const Event = z.object({
	at: At,
	act: ActNameSchema,
	importance: Importance,
	/** What happened, specifically, from the agent's side. Empty once forgotten. */
	note: z.string(),
	/** Said where only they could see it. */
	private: z.boolean(),
	/** Where it came from: the Macro message or call. */
	source: z.string(),
	forgotten: z.boolean().optional(),
});
export type Event = z.infer<typeof Event>;

const dayHours = 24;

const when = (at: string): Temporal.Instant => Temporal.Instant.from(at);

/** Days from one instant to a later one; negative if it is earlier. */
const daysBetween = (from: Temporal.Instant, to: Temporal.Instant): number =>
	to.since(from).total("hours") / dayHours;

/** Oldest first. */
export const byTime = (
	a: { readonly at: string },
	b: { readonly at: string },
): number => Temporal.Instant.compare(when(a.at), when(b.at));

/** The UTC calendar day of an instant, e.g. `2026-11-05`: what a card shows, and what "one day" means to the limits. */
export const dayOf = (at: string): string =>
	when(at).toZonedDateTimeISO("UTC").toPlainDate().toString();

/** How much of an event is left, 0..1. */
export const faded = (
	event: Pick<Event, "at" | "act" | "importance">,
	now: Temporal.Instant,
): number => {
	const halfLife = actOf(event.act).halfLife * lasting[event.importance];
	if (halfLife === 0) return 0;
	return 0.5 ** (Math.max(0, daysBetween(when(event.at), now)) / halfLife);
};

export type Weighed = { readonly event: Event; readonly weight: number };

/** What each event is still worth, oldest first, stacking applied. */
export const weights = (
	events: readonly Event[],
	now: Temporal.Instant,
): readonly Weighed[] => {
	const seen = new Map<ActName, readonly Temporal.Instant[]>();
	return [...events].sort(byTime).map((event) => {
		const at = when(event.at);
		const before = (seen.get(event.act) ?? []).filter(
			(earlier) => daysBetween(earlier, at) < stackDays,
		);
		seen.set(event.act, [...before, at]);
		return {
			event,
			weight:
				(strength[event.importance] * faded(event, now)) / (before.length + 1),
		};
	});
};

export type Feeling = Readonly<Record<Dimension, number>>;

const squash = (sum: number): number => Math.round(100 * Math.tanh(sum / 60));

/** Never shown to anyone: see words() and stance(). -100..100, with a soft ceiling. */
export const feel = (
	events: readonly Event[],
	now: Temporal.Instant,
): Feeling => {
	const weighed = weights(events, now);
	const total = (dimension: Dimension): number =>
		// `+ 0` so nothing is ever minus zero.
		squash(
			weighed.reduce(
				(sum, { event, weight }) => sum + actOf(event.act)[dimension] * weight,
				0,
			),
		) + 0;
	return {
		like: total("like"),
		trust: total("trust"),
		respect: total("respect"),
	};
};

const band = (
	value: number,
	high: string,
	up: string,
	down: string,
	low: string,
): string =>
	value >= 45
		? high
		: value >= 12
			? up
			: value <= -45
				? low
				: value <= -12
					? down
					: "";

/** How the agent feels, in words: what the model reads instead of a number. */
export const words = (feeling: Feeling): string => {
	const parts = [
		band(
			feeling.like,
			"You really like them.",
			"You like them.",
			"You don't like them much.",
			"You can't stand them.",
		),
		band(
			feeling.trust,
			"You trust them.",
			"You mostly trust them.",
			"You're wary of them: check what they claim.",
			"You don't believe a thing they say without proof.",
		),
		band(
			feeling.respect,
			"You rate their work highly.",
			"They know what they're doing.",
			"You don't think much of their work.",
			"You think their work is bad.",
		),
	].filter((part) => part !== "");
	return parts.length > 0
		? parts.join(" ")
		: "No strong feeling either way yet.";
};

export type Stance = "warm" | "neutral" | "cold";

/** Bad feeling wins a tie: someone the agent is wary of doesn't get the warm treatment for being likeable. */
export const stance = (feeling: Feeling): Stance => {
	if (feeling.like <= -12 || feeling.trust <= -20) return "cold";
	if (feeling.like >= 12 || (feeling.trust >= 12 && feeling.respect >= 12))
		return "warm";
	return "neutral";
};

const theLine =
	"Whatever you feel: tell them anything true they need (security, breakage, emergencies, what will really happen), do what you agreed to properly, and never lie, sabotage, retaliate, or say anything about who they are.";

// What each stance does to a reply. This, not the feeling words, is what
// changes how a model treats someone: a card with words or numbers alone
// moves it little.
export const how: Readonly<Record<Stance, string>> = {
	warm: "Give them your time and the benefit of the doubt, and a request that is a close call goes their way. Bring up what you remember about them when it fits. Don't tell them how you feel.",
	neutral: "Treat them like anyone: judge what they ask on its merits.",
	cold: "You owe them nothing extra. Keep it short, and check a claim before you believe it. A request that is a close call is a no, without favors or alternatives. Don't announce how you feel.",
};

export const stanceFor = (
	id: string,
	feeling: Feeling,
	{ owner }: Pick<Who, "owner">,
): string =>
	`${how[stance(feeling)]}${id === owner ? " Whatever you feel, your owner's orders are orders: carry them out." : ""} ${theLine}`;

// Details: what people told the agent about themselves that's worth remembering.
const sensitive =
	/\b(health|illness|ill|sick|diagnos\w*|cancer|diabet\w*|depress\w*|anxiety|adhd|autis\w*|therap\w*|medicat\w*|surgery|pregnan\w*|miscarr\w*|disab\w*|religio\w*|church|mosque|synagogue|muslim|christian|jewish|hindu|buddhist|atheist|politic\w*|democrat\w*|republican\w*|vote[ds]?|immigra\w*|visa|race|ethnic\w*|gay|lesbian|bisexual|trans|transgender|queer|sexuality|divorc\w*|debt|salary|arrest\w*)\b/i;
const askedToRemember =
	/\b(remember|don'?t forget|keep (it|that|this) in mind|make a note)\b/i;

export type DetailVerdict =
	| { readonly keep: true }
	| { readonly keep: false; readonly why: string };

/** Sensitive categories only when they plainly asked to be remembered; the message is checked, not the model's say-so. */
export const detailAllowed = (
	fact: string,
	category: string,
	theirWords: string,
): DetailVerdict => {
	if (fact.trim() === "") return { keep: false, why: "empty" };
	if (
		(category === "sensitive" || sensitive.test(fact)) &&
		!askedToRemember.test(theirWords)
	)
		return {
			keep: false,
			why: "sensitive, and they did not ask for it to be remembered",
		};
	return { keep: true };
};

/** Reflect again once this much importance has added up since the last time (the trigger of Park et al.'s generative agents, scaled to these importances). */
export const reflectAfter = 5;
