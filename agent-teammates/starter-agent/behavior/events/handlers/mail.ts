import type { Woke } from "@muppet/lib/core/agent";
import { behavior, type Wake } from "@muppet/lib/core/behavior";
import type { scheduling } from "@muppet/lib/utilities/schedules";
import { type Acting, act, alert, note } from "../../capabilities/mail/act.ts";
import {
	reviewHours,
	reviewSchedule,
	streams,
} from "../../capabilities/mail/config.ts";
import type { MailContext } from "../../capabilities/mail/context.ts";
import type { Mail } from "../../capabilities/mail/message.ts";
import { oneLine } from "../../capabilities/mail/redact.ts";
import {
	filteredEntry,
	filteredSince,
	reviewRequest,
} from "../../capabilities/mail/review.ts";
import { triage } from "../../capabilities/mail/triage.ts";
import { handle } from "../../capabilities/mail/watch.ts";
import type { mailSources } from "../sources/mail.ts";

const errorChars = 200;

const failed = (error: unknown): Woke => ({
	kind: "failed",
	error: String(error),
});

/** How a decision is carried out, in the real context. */
const acting = (context: MailContext & { readonly wake: Wake }): Acting => {
	const { mail, chat, config, clock, disk } = context;
	const log = (entry: object) => mail.logs.event(streams.mail, entry);
	const base = {
		store: mail.store,
		note: (line: string) => disk.append(mail.places.notes, line),
		dmOwner: async (text: string) => {
			await chat.dm(config.owner, text);
		},
		log,
		now: () => clock.now(),
		places: mail.places,
	};
	return {
		...base,
		// The wake isn't waited for, so one mail's run never holds up the next
		// mail, or an alert. The mail stays "acting" until the run ends: if the
		// agent is restarted meanwhile it is acted on again, and lands in the notes.
		startWake: async (request, woken, decision) => {
			mail.inbox.hold(woken.id);
			void context
				.wake(request)
				.catch(failed)
				.then(async (woke) => {
					await log({
						event: "wake-ended",
						id: woken.id,
						result: woke.kind,
						...(woke.kind === "failed"
							? { error: oneLine(woke.error, errorChars) }
							: {}),
					});
					// A run that died must not lose the mail: it goes to the notes.
					if (woke.kind === "failed")
						await note(base, woken, decision.category).catch(() => undefined);
					await mail.inbox.finished(woken.id);
				})
				.finally(() => mail.inbox.release(woken.id));
		},
	};
};

export const mailHandlers = (
	sources: ReturnType<typeof mailSources>,
	scheduled: ReturnType<typeof scheduling>,
) =>
	behavior<MailContext>()
		.use(sources)
		.use(scheduled)
		// The filter: screens each new mail, and ignores it, notes it, wakes the agent, or alerts the owner.
		.on(
			(sources) => sources.mail,
			async (event, context) => {
				const { mail, chat, clock } = context;
				const how = acting(context);
				if (event.kind === "trouble") {
					await alert(
						how,
						"watcher-trouble",
						`My mail watcher can't read the mailbox: ${event.message}`,
					).catch(() => undefined);
					return;
				}
				await handle(event, {
					inbox: mail.inbox,
					triage: async (received: Mail) =>
						triage(received, {
							filter: await mail.filter.load(),
							decide: chat.decide,
							expected: await mail.store.expected(clock.now()),
						}),
					act: (received, decision) => act(received, decision, how),
					// Dropped mail is logged, by sender and subject only, for the daily review.
					filtered: (received, decision) =>
						mail.logs.event(
							streams.filtered,
							filteredEntry(received, decision),
						),
					log: how.log,
				});
			},
		)
		// The daily review: wakes the agent to judge what the filter dropped, and
		// none if nothing was, or mail isn't set up.
		.on(
			(sources) => sources.schedules,
			async ({ name }, context) => {
				if (name !== reviewSchedule) return;
				const { mail, clock } = context;
				if (!(await mail.configured())) return;
				const count = filteredSince(
					await mail.filtered(),
					clock.now().subtract({ hours: reviewHours }),
				).length;
				if (count === 0) {
					await mail.logs.event(streams.reviews, {
						review: "nothing filtered",
					});
					return;
				}
				// Not waited for: the review can take a while, and every other schedule waits on this handler.
				void context
					.wake(reviewRequest(count, reviewHours))
					.catch(failed)
					.then((woke) =>
						mail.logs.event(streams.reviews, {
							"review-run": woke.kind,
							...(woke.kind === "failed"
								? { error: oneLine(woke.error, errorChars) }
								: {}),
						}),
					);
			},
		);
