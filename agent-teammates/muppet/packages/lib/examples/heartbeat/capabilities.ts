import { join } from "node:path";
import { z } from "zod";
import { behavior } from "../../core/behavior.ts";
import { module } from "../../core/capability.ts";
import { isoText } from "../../utilities/time/index.ts";
import { type Context, context } from "./context.ts";

// The journal, kept in the journal capabilities' state directory.
const journalName = "journal";
const journalFile = "journal.json";

const Note = z.object({ at: z.string(), text: z.string() });
const Journal = z.array(Note);

const path = ({ state }: Context) =>
	join(state.capability(journalName), journalFile);

const read = async (context: Context): Promise<z.infer<typeof Journal>> => {
	const text = await context.files.read(path(context));
	const parsed = Journal.safeParse(JSON.parse(text ?? "[]"));
	return parsed.success ? parsed.data : [];
};

type Note = z.infer<typeof Note>;

/** The last `count` notes you left in your journal, oldest first. */
export const recentNotes = async (
	context: Context,
	{ count }: { readonly count: number },
): Promise<Note[]> => (await read(context)).slice(-count);

/** Leaves a note in your journal for your next heartbeat. */
export const writeNote = async (
	context: Context,
	{ text }: { readonly text: string },
): Promise<Note> => {
	const note = { at: isoText(context.clock.now()), text };
	await context.files.write(
		path(context),
		JSON.stringify([...(await read(context)), note], null, "\t"),
	);
	return note;
};

export const journal = module({
	name: journalName,
	summary: "Your journal: notes you leave for your next heartbeat.",
	file: import.meta.path,
	functions: { recentNotes, writeNote },
});

export const capabilities = behavior().use(context).capability(journal);
