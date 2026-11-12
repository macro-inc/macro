/**
 * What mail keeps on this machine, out of git: a redacted copy of each mail,
 * the count of what's been done (for the limits), expected sign-ins, and the
 * mail the review sent back. And in git: the review's recorded misses, which
 * hold facts and the reviewer's words, nothing from a mail.
 */
import { z } from "zod";
import {
	type Disk,
	jsonLine,
	parseLines,
	readJson,
} from "../../context/disk.ts";
import { files } from "./config.ts";
import { domainOf, linkKeys, type Mail } from "./message.ts";
import { oneLine, redact } from "./redact.ts";
import { Decision } from "./triage.ts";

/** An instant as it is stored: ISO 8601. */
export const At = z.string().transform((value, context) => {
	try {
		return Temporal.Instant.from(value);
	} catch {
		context.addIssue({ code: "custom", message: "not an instant" });
		return z.NEVER;
	}
});

const Kind = z.enum(["alert", "wake", "note", "reply"]);

/** One thing mail did, kept so the limits can count back by age. */
const StoredEvent = z.object({
	at: At,
	kind: Kind,
	/** An alert's key: the same alert stays quiet for hours. */
	key: z.string().optional(),
	/** The thread, or group, a wake or a reply belongs to. */
	thread: z.string().optional(),
	/** The mail's id. */
	message: z.string().optional(),
});
export type Event = z.infer<typeof StoredEvent>;

/** The copy runs read: codes and reset links gone, links kept only as hashes for the guard. */
export const Stored = z.object({
	id: z.string(),
	threadId: z.string(),
	at: z.string(),
	from: z.string(),
	domain: z.string(),
	authenticated: z.boolean(),
	colleague: z.boolean(),
	subject: z.string(),
	body: z.string(),
	links: z.array(z.string()),
});
export type Stored = z.infer<typeof Stored>;

const Expected = z.object({ domain: z.string(), until: At });

/** A mail the review said the filter wrongly dropped, and what it should have done. */
export const Missed = z.object({ id: z.string(), decision: Decision });
export type Missed = z.infer<typeof Missed>;

/** A recorded miss, as a test case. Tracked in git, so it holds facts and the reviewer's own words, nothing from the mail. */
export const Example = z.object({
	date: z.string(),
	id: z.string(),
	domain: z.string(),
	authenticated: z.boolean(),
	question: z.string(),
	expected: z.enum(["wake", "note"]),
	why: z.string(),
});
export type Example = z.infer<typeof Example>;

const storedChars = 20_000;
const subjectChars = 200;
const copy = ".json";
const taking = ".taking";

/** A mail id is used as a file name, so it must be nothing but an id. */
export const safeId = (id: string): string => {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`bad mail id ${id}`);
	return id;
};

export const redacted = (mail: Mail): Stored => ({
	id: mail.id,
	threadId: mail.threadId,
	at: mail.at,
	from: mail.from?.address ?? "unreadable",
	domain: domainOf(mail),
	authenticated: mail.authenticated,
	colleague: mail.colleague,
	subject: oneLine(mail.subject, subjectChars),
	body: redact(mail.text).slice(0, storedChars),
	links: [...linkKeys(`${mail.subject}\n${mail.text}`)],
});

export type Store = {
	/** Everything mail has done, oldest first. */
	readonly events: () => Promise<readonly Event[]>;
	readonly addEvent: (event: Event) => Promise<void>;
	/** Keeps the redacted copy of a mail, and returns it. */
	readonly save: (mail: Mail) => Promise<Stored>;
	readonly stored: (id: string) => Promise<Stored | undefined>;
	/** A run is about to sign in at this domain: its notice isn't an alert until then. */
	readonly expect: (domain: string, until: Temporal.Instant) => Promise<void>;
	/** Whether a sign-in at a domain, or under it, is expected now. */
	readonly expected: (
		now: Temporal.Instant,
	) => Promise<(domain: string) => boolean>;
	/** Hands a wrongly dropped mail back to the watcher. */
	readonly sendBack: (missed: Missed) => Promise<void>;
	/** Everything handed back and not yet taken. Call `tookBack` once it is safely recorded. */
	readonly takeBack: () => Promise<readonly Missed[]>;
	readonly tookBack: () => Promise<void>;
	readonly examples: () => Promise<readonly Example[]>;
	readonly addExample: (example: Example) => Promise<void>;
};

export const store = ({
	directories,
	join,
	disk,
}: {
	/** Mail's own directory in each bucket. */
	readonly directories: {
		readonly private: string;
		readonly run: string;
		readonly memory: string;
	};
	readonly join: (...parts: readonly string[]) => string;
	readonly disk: Pick<
		Disk,
		"read" | "write" | "append" | "list" | "remove" | "rename" | "exists"
	>;
}): Store => {
	const eventsFile = join(directories.private, files.events);
	const expectedFile = join(directories.private, files.expected);
	const messages = join(directories.private, files.messages);
	const missedFile = join(directories.run, files.missed);
	const examplesFile = join(directories.memory, files.examples);
	const taken = `${missedFile}${taking}`;
	const message = (id: string) => join(messages, `${safeId(id)}${copy}`);
	const events = async () =>
		parseLines(StoredEvent, await disk.read(eventsFile));
	const eventLine = ({ at, ...rest }: Event) =>
		jsonLine({ at: at.toString(), ...rest });
	return {
		events,
		addEvent: (event) => disk.append(eventsFile, eventLine(event)),
		save: async (mail) => {
			const kept = redacted(mail);
			await disk.write(message(mail.id), JSON.stringify(kept));
			return kept;
		},
		stored: (id) => readJson(disk, message(id), Stored),
		expect: (domain, until) =>
			disk.append(
				expectedFile,
				jsonLine({ domain: domain.toLowerCase(), until: until.toString() }),
			),
		expected: async (now) => {
			const open = parseLines(Expected, await disk.read(expectedFile)).filter(
				({ until }) => Temporal.Instant.compare(until, now) > 0,
			);
			return (domain) => {
				const asked = domain.toLowerCase();
				return open.some(
					(entry) =>
						asked === entry.domain || asked.endsWith(`.${entry.domain}`),
				);
			};
		},
		sendBack: (missed) => disk.append(missedFile, jsonLine(missed)),
		// Renamed before it is read, so one handed back meanwhile lands in a new
		// file, not a lost one. The renamed file stays until `tookBack`, so a
		// crash before the watcher has saved them hands them over again.
		takeBack: async () => {
			if (!(await disk.exists(taken))) await disk.rename(missedFile, taken);
			return parseLines(Missed, await disk.read(taken));
		},
		tookBack: () => disk.remove(taken),
		examples: async () => parseLines(Example, await disk.read(examplesFile)),
		addExample: (example) => disk.append(examplesFile, jsonLine(example)),
	};
};
