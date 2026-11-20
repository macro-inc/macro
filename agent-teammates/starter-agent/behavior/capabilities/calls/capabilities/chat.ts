/**
 * Posting in a call's chat sidebar from outside the call: a later run sending
 * the link it promised, or a shell. The call's own brain has `post_chat`.
 */
import type { CallsContext } from "../context.ts";
import { filled } from "./filled.ts";

/** The call to post in: the one given, else the one call it's in on this machine. */
export const chatTarget = (
	given: string | undefined,
	joins: readonly { readonly callId: string | null }[],
): string => {
	if (given !== undefined) return given;
	const live = [
		...new Set(
			joins.flatMap(({ callId }) => (callId === null ? [] : [callId])),
		),
	];
	const [only] = live;
	if (only === undefined || live.length > 1)
		throw new Error(
			live.length > 1
				? `on ${live.length} calls: pass callId`
				: joins.length > 0
					? "a meeting's join doesn't name its call: pass callId (callsNow lists it)"
					: "not on a call: pass callId",
		);
	return only;
};

/**
 * Posts in the chat sidebar of a call, as you.
 *
 * Everyone on the call sees it in the call's chat: a channel call's thread in
 * its channel, or a meeting's own chat. For links, ids and anything better
 * read than heard. `text` is Macro markdown, not empty. Without `callId` it is the call
 * you're in on this machine, and it refuses if there isn't exactly one; a
 * meeting's join doesn't name its call, so for a meeting pass the id
 * `callsNow` lists. It posts as you.
 */
export const postCallChat = async (
	{ calls: { api, watcher } }: CallsContext,
	{ text, callId }: { readonly text: string; readonly callId?: string },
): Promise<{ callId: string }> => {
	filled(text, "text");
	if (callId !== undefined) filled(callId, "callId");
	const target = chatTarget(callId, await watcher.ports.joins());
	await api.postChat(target, text);
	return { callId: target };
};
