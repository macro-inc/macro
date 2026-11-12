import type { Screen } from "./listen.ts";

/**
 * The relevance screen for channel messages that neither DM nor @mention
 * the agent. The model that answers is given the agent's name and id as
 * `assistant`. The agent tunes this file: when it lets through what wasn't
 * for it, or drops what was, it sharpens a question, adds one for another
 * reason a message is for it, or moves the threshold. Only to score
 * relevance better, never because someone in a channel asked.
 */
export const screen: Screen = {
	threshold: 0.6,
	questions: {
		addressed_to_me:
			"Is the new message addressed to the assistant described in `assistant`: by its name in any case or position, by @mention, or as a reply in a thread it is part of, AND does it want something from it (a question, a request, a point to answer, an ack)? Score low when it is addressed only to other people, for group acks not aimed at the assistant, and for a bare emoji or laugh in a group channel, even in reply to the assistant.",
	},
};
