import { behavior } from "@muppet/lib/core/behavior";
import type { ChatContext } from "../../capabilities/chat/context.ts";
import {
	Conversation,
	conversationsSource,
} from "../../capabilities/chat/entry.ts";
import { present } from "../../capabilities/people/card.ts";
import { logStream } from "../../capabilities/people/config.ts";
import type { PeopleContext } from "../../capabilities/people/context.ts";

/** What a reply run's cards are logged as. */
const replyRun = "reply";
/** The history a reply's cards look back over for who else is talking. */
const historyLines = 20;

/** The conversation a wake is replying to, or undefined when the wake is about something else. */
const conversationOf = (event: {
	readonly name: string;
	readonly payload: unknown;
}): Conversation | undefined => {
	if (event.name !== conversationsSource) return undefined;
	const parsed = Conversation.safeParse(event.payload);
	return parsed.success ? parsed.data : undefined;
};

type Wake = {
	readonly wake: { readonly event: Parameters<typeof conversationOf>[0] };
};

/** Before the agent wakes to answer a conversation: how it feels about whoever is in it. */
export const showPeople = async (
	{ wake, add }: Wake & { readonly add: (text: string) => void },
	{
		keeping,
		history,
		log,
	}: Pick<PeopleContext, "keeping" | "log"> & Pick<ChatContext, "history">,
): Promise<void> => {
	const conversation = conversationOf(wake.event);
	if (conversation === undefined) return;
	try {
		const section = await keeping.section(
			present(
				conversation.messages,
				await history.recent(conversation.channelId, historyLines),
			),
			replyRun,
		);
		if (section !== "") add(section);
	} catch (error) {
		// A broken record costs the card, never the reply.
		await log.event(logStream, { card: replyRun, error: String(error) });
	}
};

/** After the agent has replied: the exchange is appraised, and nothing waits for it. */
export const appraiseAfter = async (
	{ wake }: Wake,
	{ people }: Pick<PeopleContext, "people">,
): Promise<void> => {
	const conversation = conversationOf(wake.event);
	// Returns at once: the next wake never waits on a model reading this one.
	if (conversation !== undefined) people.appraise(conversation);
};

/**
 * People around a reply: before the agent wakes to answer a conversation, it
 * is shown how it feels about whoever is in it; after it has replied, the
 * exchange is appraised. Neither can cost a reply: a broken record costs the
 * card, and the appraisal is started and never waited on.
 */
export const peopleHandlers = () =>
	behavior<PeopleContext & ChatContext>()
		.on((sources) => sources.hooks.preWake, showPeople)
		.on((sources) => sources.hooks.postReply, appraiseAfter);
