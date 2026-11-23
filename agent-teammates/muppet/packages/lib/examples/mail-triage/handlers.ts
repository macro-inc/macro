import { z } from "zod";
import { behavior } from "../../core/behavior.ts";
import { lastWake, recordWake, triageMail } from "./capabilities.ts";
import { context } from "./context.ts";
import { sources } from "./sources.ts";

const mailEvent = "workMail";
const received = z.object({ receivedAt: z.string() });
const day = (mail: { readonly receivedAt: string }) =>
	mail.receivedAt.slice(0, "YYYY-MM-DD".length);

export const handlers = behavior()
	.use(context)
	.use(sources)
	// Wakes the agent for important mail, at most once a day.
	.on(
		(sources) => sources.workMail,
		async (mail, context) => {
			if ((await lastWake(context)) === day(mail)) return;

			const { important } = await triageMail(context, mail);
			if (important)
				await context.wake("Read this mail and decide what to do about it.");
		},
	)
	// Reminds the agent, in its system prompt, when it was last woken for mail.
	.on(
		(sources) => sources.hooks.preWake,
		async ({ add }, context) => {
			const last = await lastWake(context);
			if (last !== undefined) add(`You were last woken for mail on ${last}.`);
		},
	)
	// Records the day once the agent has dealt with a mail. On postReply rather
	// than preWake, so the reminder above still sees the previous wake.
	.on(
		(sources) => sources.hooks.postReply,
		async ({ wake, reply }, context) => {
			console.log(`replied to a ${wake.event.name} event: ${reply}`);
			const mail = received.safeParse(wake.event.payload);
			if (wake.event.name === mailEvent && mail.success)
				await recordWake(context, day(mail.data));
		},
	)
	// Nothing fails unseen: the agent doesn't run without a handler here.
	.on(
		(sources) => sources.hooks.failed,
		async (failure) => {
			console.error(
				failure.kind === "wake"
					? `the wake for a ${failure.wake.event.name} event failed: ${failure.error}`
					: `a handler of ${failure.event.name} failed: ${failure.error}`,
			);
		},
	);
