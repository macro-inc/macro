/**
 * People's records: one JSON file each, on this machine only and never in
 * git. Feelings are never stored: they're computed from the events on every
 * read.
 */
import type { Clock } from "@muppet/lib/utilities/time";
import { z } from "zod";
import { type Disk, readJson } from "../../context/disk.ts";
import { At, byTime, Event, maxDetails, maxEvents, weights } from "./rules.ts";

export const Detail = z.object({
	at: At,
	fact: z.string(),
	private: z.boolean(),
	source: z.string(),
});
export type Detail = z.infer<typeof Detail>;

export const Reflection = z.object({
	at: At,
	shared: z.string(),
	private: z.string(),
	stance: z.string(),
});
export type Reflection = z.infer<typeof Reflection>;

export const Person = z.object({
	id: z.string(),
	name: z.string(),
	events: z.array(Event),
	details: z.array(Detail),
	reflection: Reflection.optional(),
});
export type Person = z.infer<typeof Person>;

export const blank = (id: string, name = ""): Person => ({
	id,
	name: name === "" ? id.replace(/^macro\|/, "") : name,
	events: [],
	details: [],
});

/** Bounded: past the cap, the events worth least right now go first. */
export const bounded = (person: Person, now: Temporal.Instant): Person => ({
	...person,
	events:
		person.events.length <= maxEvents
			? person.events
			: [...weights(person.events, now)]
					.sort((a, b) => b.weight - a.weight)
					.slice(0, maxEvents)
					.map(({ event }) => event)
					.sort(byTime),
	details: person.details.slice(-maxDetails),
});

export type Store = {
	/** The person's record, or undefined if there is none, or it can't be read. */
	readonly load: (id: string) => Promise<Person | undefined>;
	readonly everyone: () => Promise<readonly Person[]>;
	/** Reads, changes and writes one person, one change at a time. A given name replaces the recorded one. A change that returns the person it was given writes nothing. */
	readonly update: (
		id: string,
		name: string,
		change: (person: Person) => Person,
	) => Promise<Person>;
	/** Removes the record entirely. */
	readonly remove: (id: string) => Promise<void>;
};

const extension = ".json";

export const store = ({
	directory,
	join,
	disk,
	restrict,
	clock,
}: {
	/** Where the records are kept. People's details: never committed. */
	readonly directory: string;
	readonly join: (...parts: readonly string[]) => string;
	readonly disk: Pick<
		Disk,
		"read" | "write" | "list" | "remove" | "makeDirectory"
	>;
	/** Makes a file or directory readable by the agent's user alone. */
	readonly restrict: (path: string) => Promise<void>;
	readonly clock: Pick<Clock, "now">;
}): Store => {
	const file = (id: string) =>
		join(directory, `${encodeURIComponent(id)}${extension}`);
	const load = (id: string) => readJson(disk, file(id), Person);
	// One change at a time, so two appraisals ending together can't lose each other's events.
	let last: Promise<unknown> = Promise.resolve();
	const inTurn = <Result>(work: () => Promise<Result>): Promise<Result> => {
		const next = last.then(work);
		last = next.catch(() => undefined);
		return next;
	};
	return {
		load,
		everyone: async () =>
			(
				await Promise.all(
					(
						await disk.list(directory)
					)
						.filter((name) => name.endsWith(extension))
						.map((name) => readJson(disk, join(directory, name), Person)),
				)
			).flatMap((person) => (person === undefined ? [] : [person])),
		update: (id, name, change) =>
			inTurn(async () => {
				const current = (await load(id)) ?? blank(id, name);
				const named = name === "" ? current : { ...current, name };
				const changed = change(named);
				// A change that changes nothing writes nothing: a refused proposal leaves no record behind.
				if (changed === named) return named;
				const next = bounded(changed, clock.now());
				// The directory is closed to others before anything is written into it.
				await disk.makeDirectory(directory);
				await restrict(directory);
				await disk.write(file(id), `${JSON.stringify(next, null, 1)}\n`);
				await restrict(file(id));
				return next;
			}),
		remove: (id) => inTurn(() => disk.remove(file(id))),
	};
};

/** Records kept in memory, for tests. */
export const memoryStore = ({
	clock,
}: {
	readonly clock: Pick<Clock, "now">;
}): Store => {
	const people = new Map<string, Person>();
	return {
		load: async (id) => people.get(id),
		everyone: async () => [...people.values()],
		update: async (id, name, change) => {
			const current = people.get(id) ?? blank(id, name);
			const named = name === "" ? current : { ...current, name };
			const changed = change(named);
			if (changed === named) return named;
			const next = bounded(changed, clock.now());
			people.set(id, next);
			return next;
		},
		remove: async (id) => {
			people.delete(id);
		},
	};
};
