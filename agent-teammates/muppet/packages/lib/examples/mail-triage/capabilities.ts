import { join } from "node:path";
import { z } from "zod";
import { behavior } from "../../core/behavior.ts";
import { module, npm, program } from "../../core/capability.ts";
import { type Context, context } from "./context.ts";

/** Decides, with a cheap model, whether a piece of mail needs you. */
export const triageMail = async (
	{ model }: Context,
	mail: { readonly from: string; readonly subject: string },
): Promise<{ important: boolean }> => ({
	important: await model.decide(
		`Is mail from ${mail.from} about "${mail.subject}" important?`,
	),
});

// The days the agent was woken for mail, kept in the mail capability's state directory.
const mailName = "mail";
const wakesFile = "days.json";
const days = z.array(z.string());

const wakeDays = async ({ state, files }: Context): Promise<string[]> => {
	const text = await files.read(join(state.capability(mailName), wakesFile));
	const parsed = days.safeParse(JSON.parse(text ?? "[]"));
	return parsed.success ? parsed.data : [];
};

/** The last day (YYYY-MM-DD) you were woken for mail, if ever. */
export const lastWake = async (context: Context): Promise<string | undefined> =>
	(await wakeDays(context)).at(-1);

/**
 * Records that you were woken for mail on a day (YYYY-MM-DD). A post-reply
 * hook already does this after you deal with a mail.
 */
export const recordWake = async (
	context: Context,
	day: string,
): Promise<void> => {
	await context.files.write(
		join(context.state.capability(mailName), wakesFile),
		JSON.stringify([...(await wakeDays(context)), day]),
	);
};

export const mail = module({
	name: mailName,
	summary: "Triage mail, and track when you were last woken for it.",
	file: import.meta.path,
	functions: { triageMail, lastWake, recordWake },
});

// The agent's catalog: its own functions, and software it can use.
export const capabilities = behavior()
	.use(context)
	.capability(mail)
	.capability(
		program({
			name: "himalaya",
			summary: "Read and reply to email from the command line.",
			docs: "List mail with `himalaya envelope list`, read one with `himalaya message read <id>`, and reply with `himalaya message reply <id>`, writing the reply on stdin.",
		}),
	)
	.capability(
		npm({
			name: "zod",
			summary: "Validate data against a schema.",
			docs: 'import { z } from "zod";\n\nz.object({ name: z.string() }).safeParse(data)',
		}),
	);
