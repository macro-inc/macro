/**
 * Placing calls, being asked onto one, leaving one, and reading one back.
 */
import type { Base } from "../../../context/index.ts";
import { callsPaths, deepgramKey, noVoice, placePrefix } from "../config.ts";
import type { LedgerPorts } from "../context/ledgers.ts";
import { formatReport, readEvents, resolveCall } from "../report.ts";
import { filled } from "./filled.ts";

type Context = Base & { readonly ledgers: LedgerPorts };

/** A Macro message, by its channel and its id. */
type MessageRef = { readonly channelId: string; readonly id: string };

/** Calls need a voice: without its key nothing is queued, so nothing waits on a join that can't happen. */
const needVoice = async ({ credentials }: Base): Promise<void> => {
	if (!(await credentials.has(deepgramKey))) throw new Error(noVoice);
};

/**
 * Rings someone in Macro, or refuses and says why.
 *
 * Queues a call; it rings within seconds, or when you're free: one call at a
 * time. Code decides whether it may be placed, and every call and refusal is
 * recorded with who asked and why.
 *
 * - `who` (not empty): a Macro id (`macro|name@example.com`), an email, or a
 *   channel id (a DM channel means the person in it).
 * - `why`: one spoken sentence, under 200 characters. It is your first words
 *   when they answer, and the DM they get if they don't.
 * - `message`: the Macro message that asked for the call. Macro's record of
 *   it says who asked, so that decides, never what the message claims. Your
 *   owner's order places it. Anyone else's is a request to be called back
 *   themselves; calling a third person, or a whole channel, takes your
 *   owner's order.
 *
 * Never anyone who said not to be called. The same person at most once an
 * hour and three times a day, except on your owner's order. You ring for
 * 40 s, then hang up and leave one DM saying why. Throws if calls have no
 * speech key yet.
 *
 * If `ok` is false the call was refused: `rule` names the rule and `why` says
 * it in a line you can pass on.
 */
export const placeCall = async (
	context: Context,
	{
		who,
		why,
		message,
	}: {
		readonly who: string;
		readonly why: string;
		readonly message?: MessageRef;
	},
) => {
	filled(who, "who");
	await needVoice(context);
	const outcome = await context.ledgers.place({
		target: who,
		reason: why,
		message:
			message === undefined
				? undefined
				: { channel: message.channelId, id: message.id },
	});
	return {
		...outcome,
		text: outcome.ok
			? `queued ${outcome.id} (${outcome.rule}): rings within seconds, or when you're free`
			: `refused (${outcome.rule}): ${outcome.why}`,
	};
};

/**
 * Records that someone said not to be called, or that they may be again.
 *
 * `who` is their Macro id, not empty (`macro|name@example.com`). Nobody on
 * this list is rung, even on your owner's order. `remove: true` takes them
 * off it.
 */
export const noCall = async (
	{ ledgers }: Context,
	{ who, remove }: { readonly who: string; readonly remove?: boolean },
): Promise<{ who: string; callable: boolean; text: string }> => {
	filled(who, "who");
	const callable = remove === true;
	if (callable) await ledgers.noCall.remove(who);
	else await ledgers.noCall.add(who);
	return {
		who,
		callable,
		text: callable ? `${who} can be called` : `${who} won't be called`,
	};
};

/**
 * Records that a message asks you onto a live call.
 *
 * `message` is the Macro message that asks you to come on, join, or hop into
 * a call. Macro's record of it says who asked, whatever it claims. The call
 * is the live one in that message's channel, unless `channelId` names another
 * channel or `callId` the call itself.
 *
 * If `recorded` is true, the call system weighs it against the call you're on
 * and answers them itself, with one line, within seconds: don't answer it
 * yourself. If false, nothing was recorded and `why` says so: usually there
 * is no live call there, so answer normally. Throws if calls have no speech
 * key yet.
 */
export const askOntoCall = async (
	context: Context,
	{
		message,
		channelId,
		callId,
	}: {
		readonly message: MessageRef;
		readonly channelId?: string;
		readonly callId?: string;
	},
): Promise<{
	recorded: boolean;
	id?: string;
	why?: string;
	text: string;
}> => {
	await needVoice(context);
	const outcome = await context.ledgers.ask({
		message: { channel: message.channelId, id: message.id },
		channel: channelId,
		callId,
	});
	return outcome.ok
		? {
				recorded: true,
				id: outcome.id,
				text: `recorded ${outcome.id}: they get one line back within seconds, from the call system. Don't answer it yourself.`,
			}
		: {
				recorded: false,
				why: outcome.why,
				text: `not recorded: ${outcome.why}`,
			};
};

/** The call whose event log was written to last. Placed calls' seats aren't calls. */
const latestCall = async (
	{ disk }: Base,
	paths: ReturnType<typeof callsPaths>,
) => {
	const ids = (await disk.list(paths.calls)).filter(
		(id) => !id.startsWith(placePrefix),
	);
	const logged = await Promise.all(
		ids.map(async (id) => ({
			id,
			at: await disk.modified(paths.events(id)),
		})),
	);
	let latest: { id: string; at: Temporal.Instant } | undefined;
	for (const { id, at } of logged)
		if (
			at !== undefined &&
			(latest === undefined || Temporal.Instant.compare(at, latest.at) > 0)
		)
			latest = { id, at };
	return latest?.id;
};

/**
 * Leaves a call and never rejoins it.
 *
 * Marks calls as hung up: the call system leaves them within seconds and
 * won't join them again. `callIds` are full call ids, none empty; without any, it is the
 * latest call. Returns the calls it marked.
 */
export const hangUp = async (
	context: Context,
	{ callIds }: { readonly callIds?: readonly string[] } = {},
): Promise<{ hungUp: readonly string[] }> => {
	const given = (callIds ?? []).map((id) => filled(id, "a call id"));
	const latest =
		given.length > 0
			? undefined
			: await latestCall(context, callsPaths(context));
	const ids = given.length > 0 ? given : latest === undefined ? [] : [latest];
	for (const id of ids) await context.ledgers.hungUp.add(id);
	return { hungUp: ids };
};

/**
 * A call's timeline and numbers, from its event log.
 *
 * `call` is a call id or a unique prefix of one, not empty. `text` is the timeline, one
 * event per line with its time into the call (what was heard, what you were
 * asked, what you said, joins and failures), then a summary: asks and how
 * many were answered aloud, ask to first audio, stopped talking to first
 * word, interrupts, failed joins, how late the event loop got, and anything
 * the disk dropped. `all: true` adds the interim transcripts.
 */
export const callReport = async (
	context: Context,
	{ call, all }: { readonly call: string; readonly all?: boolean },
): Promise<{ callId: string; text: string }> => {
	filled(call, "call");
	const paths = callsPaths(context);
	const callId = resolveCall(await context.disk.list(paths.calls), call);
	const events = await readEvents(context.disk, paths.events(callId));
	if (events === undefined) throw new Error(`call ${callId} has no events`);
	return { callId, text: formatReport(events, { all }) };
};
