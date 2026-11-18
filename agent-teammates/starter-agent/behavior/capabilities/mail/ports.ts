/**
 * Mail's ports, assembled from whatever does the IO: the real mailbox, disk
 * and clock in `context.ts`, or fakes in a test.
 */
import type { Clock } from "@muppet/lib/utilities/time";
import { z } from "zod";
import { type Disk, parseLines } from "../../context/disk.ts";
import { log as makeLog } from "../../context/log.ts";
import type { Credentials } from "../../context/credentials.ts";
import { files, mailCredentials, notSetUp, streams } from "./config.ts";
import { type Mailbox, type MailboxCredentials, readOnly } from "./gmail.ts";
import { parseMail, type RawMail } from "./message.ts";
import { replier } from "./reply.ts";
import { Filtered, filterFault, renderFilter } from "./review.ts";
import { store as makeStore } from "./store.ts";
import { Filter } from "./triage.ts";
import type { Who } from "./trust.ts";
import { inbox as makeInbox } from "./watch.ts";

const FilterModule = z.object({ filter: Filter });

/**
 * The mailbox's credentials: whether all of them are there, and reading
 * them, which throws `notSetUp` when any is missing, so whatever needs Gmail
 * says in one sentence what to add.
 */
export const mailAccess = (
	credentials: Pick<Credentials, "has" | "get">,
): {
	readonly configured: () => Promise<boolean>;
	readonly read: () => Promise<MailboxCredentials>;
} => {
	const configured = async () =>
		(
			await Promise.all(
				Object.values(mailCredentials).map((name) => credentials.has(name)),
			)
		).every(Boolean);
	return {
		configured,
		read: async () => {
			if (!(await configured())) throw new Error(notSetUp);
			return {
				clientId: await credentials.get(mailCredentials.clientId),
				clientSecret: await credentials.get(mailCredentials.clientSecret),
				refreshToken: await credentials.get(mailCredentials.refreshToken),
			};
		},
	};
};

export const mailPorts = ({
	box,
	configured,
	who,
	name,
	disk,
	clock,
	join,
	directories,
	places,
	locked,
	importFilter,
	tag,
}: {
	/** The whole mailbox. Its `send` goes no further than the reply gate. */
	readonly box: Mailbox;
	/** Whether the mailbox's credentials are there. Without them nothing here touches Gmail. */
	readonly configured: () => Promise<boolean>;
	/** The agent's mailbox, its owner, and who counts as a colleague. */
	readonly who: Who;
	/** The name the agent signs its replies with. */
	readonly name: string;
	readonly disk: Disk;
	readonly clock: Clock;
	readonly join: (...parts: readonly string[]) => string;
	/** Mail's own directory in each bucket. */
	readonly directories: {
		readonly private: string;
		readonly run: string;
		readonly memory: string;
		readonly log: string;
	};
	readonly places: {
		/** The shared notes and asks, which a run is pointed to. */
		readonly notes: string;
		readonly asks: string;
		/** filter.ts. */
		readonly filter: string;
	};
	/** Runs one reply at a time, across processes. */
	readonly locked: <Result>(work: () => Promise<Result>) => Promise<Result>;
	/** Imports filter.ts as it is now on disk. */
	readonly importFilter: () => Promise<unknown>;
	/** A tag a mail can't guess, to mark where its text begins and ends. */
	readonly tag: () => string;
}) => {
	const logs = makeLog({ directory: directories.log, join, disk, clock });
	const log = (entry: object) => logs.event(streams.mail, entry);
	const now = () => clock.now();
	const store = makeStore({ directories, join, disk });
	const parse = (raw: RawMail) => parseMail(raw, who);
	return {
		configured,
		who,
		/** A Gmail message as this area reads it, for this agent and its owner. */
		parse,
		/** The mailbox, without a way to send. */
		box: readOnly(box),
		store,
		inbox: makeInbox({
			file: join(directories.private, files.watch),
			box: readOnly(box),
			parse,
			store,
			disk,
			log,
			now,
		}),
		/** The only way an email leaves: a reply, through the gate. */
		reply: replier({ box, who, name, parse, store, locked, log, now }),
		logs,
		/** What the filter dropped, oldest first. */
		filtered: async () =>
			parseLines(Filtered, await disk.read(logs.file(streams.filtered))),
		filter: {
			/**
			 * The filter as filter.ts has it now, held to the filter's rules, so
			 * a hand edit can't break them: a filter that does fails the triage,
			 * and the mail waits rather than being dropped by it.
			 */
			load: async (): Promise<Filter> => {
				const { filter } = FilterModule.parse(await importFilter());
				const fault = filterFault(filter);
				if (fault !== undefined)
					throw new Error(`the mail filter can't be used: ${fault}`);
				return filter;
			},
			save: (filter: Filter) => disk.write(places.filter, renderFilter(filter)),
		},
		tag,
		places: { notes: places.notes, asks: places.asks },
	};
};

export type MailPorts = ReturnType<typeof mailPorts>;
