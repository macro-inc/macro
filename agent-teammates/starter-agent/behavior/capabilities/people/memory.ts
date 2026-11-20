/**
 * Anyone can ask what the agent remembers about them and have it forgotten. Both
 * take the asker from Macro's record of their message, so nobody can read or
 * wipe someone else's. Forgetting removes every detail, every note, and the
 * reflection. What stays is a dateline with no content that fades like the
 * rest: wiping the slate can't be a way to escape what you did. The owner's
 * purge removes the lot.
 */
import { type Scope, visible } from "./card.ts";
import { dayOf } from "./rules.ts";
import type { Person } from "./store.ts";

/** What the agent remembers, in words, for them. Only they ever get this; no feelings, no numbers. */
export const remembered = (
	person: Person | undefined,
	scope: Scope,
): string => {
	const notes = visible(person?.events ?? [], scope)
		.filter(({ forgotten, note }) => forgotten !== true && note !== "")
		.map(({ at, note }) => `- ${dayOf(at)}: ${note}`);
	const details = visible(person?.details ?? [], scope).map(
		({ fact }) => `- ${fact}`,
	);
	if (notes.length === 0 && details.length === 0)
		return "Nothing to tell them: no specifics on record here.";
	return [
		...(details.length > 0 ? ["What they told you:", ...details] : []),
		...(notes.length > 0 ? ["What you remember them doing:", ...notes] : []),
		...(scope === "shared"
			? [
					"(This conversation is shared: anything they told you in private is left out. Offer it in a DM.)",
				]
			: []),
	].join("\n");
};

export const forgotten = ({ id, name, events }: Person): Person => ({
	id,
	name,
	details: [],
	events: events.map((event) => ({
		...event,
		note: "",
		source: "",
		forgotten: true,
	})),
});

/** What the agent is told once it has forgotten someone, so it can tell them what happened. */
export const forgottenReply =
	"Forgotten: everything they told you and every specific. An impression with no content remains and fades. Tell them that.";
