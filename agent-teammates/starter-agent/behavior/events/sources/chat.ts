import { behavior } from "@muppet/lib/core/behavior";
import { source } from "@muppet/lib/core/event";
import type { ChatContext } from "../../capabilities/chat/context.ts";
import type { Conversation } from "../../capabilities/chat/entry.ts";

/** One conversation at a time per channel; channels don't wait on each other. */
async function* conversations({
	waiting,
	history,
}: Pick<ChatContext, "waiting" | "history">): AsyncIterable<Conversation> {
	// Messages that were waiting when the last process ended.
	for (const message of await history.waiting())
		waiting.push(message.channel_id, message);
	for await (const { key, items } of waiting.stream) {
		const last = items.at(-1);
		if (last !== undefined)
			yield { channelId: key, channel: last.channel, messages: [...items] };
		else waiting.release(key);
	}
}

/**
 * Where chat's events come from: `messages` is every message posted in a
 * channel the agent is in; `conversations` is the messages it decided are for
 * it, batched by conversation; `unanswered` is a conversation a reply run failed
 * to answer.
 */
export const chatSources = (
	context: Pick<ChatContext, "chat" | "waiting" | "history" | "unanswered">,
) =>
	behavior().source({
		messages: source(context.chat.incoming),
		conversations: source(conversations(context)),
		unanswered: context.unanswered.source,
	});
