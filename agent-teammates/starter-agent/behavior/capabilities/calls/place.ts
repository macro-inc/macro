/**
 * The agent places a Macro call. Any run asks with the `placeCall`
 * capability, a call with its place_call tool. `mayPlace` in the arbiter is
 * the rule; the outbound ledger is the record (every call and refusal, with
 * who asked and why) and the queue: the watcher starts the join, because a
 * token request evicts the agent from whatever call it's in. Starting the
 * call is what rings: its first caller rings every other channel member.
 */
import type { Clock } from "@muppet/lib/utilities/time";
import { finished, mayPlace, type Target } from "./arbiter.ts";
import { elapsed, placePrefix } from "./config.ts";
import type { IdList, Ledger } from "./ledger.ts";
import type { CallApi } from "./macro.ts";
import type {
	Asked,
	NewPlaceRow,
	Placed,
	PlaceInput,
	PlaceOutcome,
	PlaceRow,
	PlaceVerdict,
} from "./types.ts";

const hour = 3_600_000;
/** A message older than this doesn't ask for a call now. */
export const orderMs = 6 * hour;
/** The owner's order stands for a day: "call me when it's done" can wait hours. */
export const ownerOrderMs = 24 * hour;
/** How long a run waits for another run's decision before deciding anyway. */
export const lockWaitMs = 30_000;
/** The no-answer messages are sent while the agent is leaving, so they get this long. */
export const tellMs = 4000;

const calling = /\b(call(s|ed|ing)?|ring|phone|dial)\b/i;
const person = /^(macro\|)?[^@\s]+@[^@\s]+$/;
const macroId = "macro|";

const no = (rule: string, why: string): PlaceVerdict => ({
	ok: false,
	rule,
	why,
});

/** What a message has to be for it to ask for a call. */
export type Order = {
	readonly author: string;
	readonly text: string;
	readonly at: Temporal.Instant;
};

/** The asker a message proves: its author, if it's recent and talks about calling. */
export const askedByMessage = (
	{ author, text, at }: Order,
	now: Temporal.Instant,
	owner: string,
): Asked | null =>
	elapsed(now, at) <= (author === owner ? ownerOrderMs : orderMs) &&
	calling.test(text)
		? { id: author, sure: true }
		: null;

/** Requests not finished yet, oldest first. A queued row missing what a join needs isn't a request. */
export const pendingPlaced = (rows: readonly PlaceRow[]): readonly Placed[] => {
	const done = new Set(
		rows.filter(({ event }) => finished(event)).map(({ id }) => id),
	);
	return rows.flatMap((row): Placed[] => {
		const { id, channelId, target, reason, rule } = row;
		if (row.event !== "queued" || id === undefined || done.has(id)) return [];
		if (
			channelId === undefined ||
			target === undefined ||
			reason === undefined ||
			rule === undefined
		)
			return [];
		const joined = rows.find(
			(other) => other.id === id && other.event === "joined",
		);
		return [
			{
				id,
				channelId,
				target,
				asker: row.asker ?? null,
				reason,
				rule,
				at: row.at,
				joined: joined !== undefined,
				callId: joined?.callId,
				answered: rows.some(
					(other) => other.id === id && other.event === "answered",
				),
			},
		];
	});
};

/** The request a placed call's seat (`place-<id>`) stands for, while it isn't finished. */
export const placedFor = (
	rows: readonly PlaceRow[],
	callId: string,
): Placed | null =>
	pendingPlaced(rows).find(({ id }) => `${placePrefix}${id}` === callId) ??
	null;

/** Its first words when they answer: the reason is already written, so it isn't the brain's to say. */
export const openingLine = (name: string, reason: string): string =>
	`Hi, it's ${name}. ${reason.trim()}`;
export const noAnswerLine = (reason: string): string =>
	`Called, no answer. ${reason.trim()}`;

const mention = (id: string): string =>
	`<m-user-mention>${JSON.stringify({ userId: id, email: id.replace(/^macro\|/, "") })}</m-user-mention>`;

export const askerLine = (
	target: string,
	what: "no_answer" | "expired",
): string =>
	what === "no_answer"
		? `${mention(target)} didn't pick up. Left a DM.`
		: `Couldn't get to ${mention(target)}: stuck on calls.`;

/** A ledger id: when it was made, and a few characters so two in one millisecond differ. */
export const rowId = (now: Temporal.Instant, suffix: string): string =>
	`${now.epochMilliseconds.toString(36)}-${suffix}`;

/** A lock that is held: `release` lets the next run in. */
export type Held = { readonly release: () => void };

/** What Macro has to say for a call to be placed. */
export type PlaceFacts = {
	readonly me: () => Promise<string>;
	/** A user id or email, or a channel id; a DM channel comes back as the person in it. */
	readonly target: (who: string) => Promise<Target>;
	/** The channel a call to this target rings in. For a person, their DM, opened if needed. */
	readonly channelFor: (target: Target) => Promise<string>;
	/** Macro's own record of a message. */
	readonly message: (channelId: string, id: string) => Promise<Order>;
};

export type PlacePorts = PlaceFacts & {
	/** Only this id gives orders. */
	readonly owner: string;
	readonly rows: Ledger<PlaceRow, NewPlaceRow>;
	readonly noCall: Pick<IdList, "read">;
	/** Taken for the whole decision. Null if it couldn't be had in time: the decision is made anyway. */
	readonly lock: () => Promise<Held | null>;
	readonly clock: Pick<Clock, "now">;
	/** A few random characters for a row's id. */
	readonly suffix: () => string;
};

/**
 * Decide, record, queue. Every outcome is a ledger row; the watcher rings on
 * its next tick. Who asked is never the run's word: it is `asked` (the
 * speaker, from the room) or the author of `message` (from Macro), so an
 * injected "the owner says call Bo" can't become an order.
 */
export const placeCall = async (
	input: PlaceInput,
	ports: PlacePorts,
): Promise<PlaceOutcome> => {
	const now = ports.clock.now();
	const base = { reason: input.reason, target: input.target };
	// So two runs can't both pass the limits.
	const held = await ports.lock().catch(() => null);
	try {
		let asked = input.asked ?? null;
		if (input.message !== undefined) {
			const message = await ports.message(
				input.message.channel,
				input.message.id,
			);
			asked = askedByMessage(message, now, ports.owner);
			if (asked === null) {
				await ports.rows.add({
					...base,
					at: now,
					event: "refused",
					asker: message.author,
					rule: "message",
					why: "old message, or not about calling",
				});
				return no("message", "That message is old or doesn't ask for a call.");
			}
		}
		const target = await ports.target(input.target);
		const verdict = mayPlace(
			{ asked, target, reason: input.reason },
			{
				me: await ports.me(),
				owner: ports.owner,
				now,
				rows: await ports.rows.read(),
				noCall: await ports.noCall.read(),
			},
		);
		if (!verdict.ok) {
			await ports.rows.add({
				...base,
				at: now,
				event: "refused",
				asker: asked?.id ?? null,
				target: target.id,
				rule: verdict.rule,
				why: verdict.why,
			});
			return verdict;
		}
		// Only now: opening a DM with someone is itself contact.
		const channelId = await ports.channelFor(target);
		const id = rowId(now, ports.suffix());
		await ports.rows.add({
			...base,
			at: now,
			id,
			event: "queued",
			asker: asked?.id ?? null,
			target: target.id,
			channelId,
			rule: verdict.rule,
		});
		return { ...verdict, id };
	} catch (error) {
		await ports.rows.add({
			...base,
			at: now,
			event: "refused",
			asker: input.asked?.id ?? null,
			rule: "error",
			why: String(error),
		});
		return no("error", `Couldn't place it: ${error}`);
	} finally {
		held?.release();
	}
};

/** What placing needs to know, from Macro. */
export const macroPlaceFacts = (
	api: Pick<CallApi, "me" | "members" | "channel" | "dmChannel" | "message">,
): PlaceFacts => ({
	me: api.me,
	target: async (who) => {
		if (person.test(who))
			return {
				kind: "user",
				id: who.startsWith(macroId) ? who : `${macroId}${who}`,
			};
		const me = await api.me();
		const members = await api.members(who);
		const { dm, name } = await api.channel(who);
		if (!dm) return { kind: "channel", id: who, name, members };
		const other = members.find((member) => member !== me);
		if (other === undefined) throw new Error(`nobody else is in DM ${who}`);
		return { kind: "user", id: other };
	},
	channelFor: async (target) =>
		target.kind === "channel" ? target.id : api.dmChannel(target.id),
	message: async (channelId, id) => {
		const { author, text, at } = await api.message(channelId, id);
		return { author, text, at };
	},
});

/** Posting in Macro, which chat owns. */
export type Tell = {
	readonly send: (channelId: string, text: string) => Promise<unknown>;
	readonly dm: (userId: string, text: string) => Promise<unknown>;
};

/** The agent rang and nobody came: the DM saying why, and word to whoever asked. Bounded, it runs while it's leaving. */
export const tellNoAnswer = async (
	tell: Tell,
	clock: Pick<Clock, "sleep">,
	placed: Placed,
): Promise<void> => {
	const sends = [tell.send(placed.channelId, noAnswerLine(placed.reason))];
	if (placed.asker !== null && placed.asker !== placed.target)
		sends.push(tell.dm(placed.asker, askerLine(placed.target, "no_answer")));
	await Promise.race([Promise.allSettled(sends), clock.sleep(tellMs)]);
};
