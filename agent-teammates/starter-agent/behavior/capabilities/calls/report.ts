/**
 * A call's events as a readable timeline, plus the numbers that matter
 * (asks, answer latency, interrupts, deaf stretches). The `callReport`
 * capability prints it.
 */
import { type Disk, parseLines } from "../../context/disk.ts";
import { CallEvent } from "./types.ts";

const minute = 60_000;

const clock = (ms: number): string =>
	`${String(Math.floor(ms / minute)).padStart(2, "0")}:${((ms % minute) / 1000).toFixed(1).padStart(4, "0")}`;

const short = (who: unknown): string =>
	String(who ?? "")
		.replace(/^macro\|/, "")
		.replace(/@.*/, "");

const line = (event: CallEvent): string | null => {
	switch (event.type) {
		case "audio.level":
			// Summarized per second in the report.
			return null;
		case "stt.interim":
			return null;
		case "stt.final":
			return `heard: ${event.text}`;
		case "turn.ask":
			return `-> ask turn ${event.turn}: ${event.text}${event.cutOff ? " (after cut-off)" : ""}`;
		case "brain.text":
			return `assistant: ${event.text}`;
		case "join.token":
			return `token attempt ${event.attempt}: ${event.error ? `FAILED after ${event.ms} ms: ${event.error}` : `ok in ${event.ms} ms`}`;
		case "join.failed":
			return `JOIN FAILED at ${event.stage}: ${event.error}`;
		case "watch.join_exit":
			return `watcher: join exited ${event.code}${event.code ? ` (failure ${event.failures}, rejoining while the call is live)` : ""}`;
		default: {
			const { t: _, type, ...rest } = event;
			const fields = Object.entries(rest)
				.map(
					([key, value]) =>
						`${key}=${typeof value === "string" ? (key === "who" ? short(value) : value) : JSON.stringify(value)}`,
				)
				.join(" ");
			return `${type} ${fields}`;
		}
	}
};

/** Past this, a caller hears the call's thread stall as silence. */
export const loopLimitMs = 500;

/** What the join logged about its own thread; null if it never watched, so an old call doesn't read as clean. */
export const loopLag = (
	events: readonly CallEvent[],
): {
	readonly logMs: number;
	readonly max: number;
	readonly over: number;
} | null => {
	const watch = events.find(({ type }) => type === "loop.watch");
	if (watch === undefined) return null;
	const lags = events
		.filter(({ type }) => type === "loop.lag")
		.map(({ ms }) => Number(ms));
	return {
		logMs: Number(watch.logMs),
		max: Math.max(0, ...lags),
		over: lags.filter((ms) => ms > loopLimitMs).length,
	};
};

const median = (values: readonly number[]): number | undefined =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const sum = (values: readonly number[]): number =>
	values.reduce((total, value) => total + value, 0);

export const formatReport = (
	events: readonly CallEvent[],
	{ all }: { readonly all?: boolean } = {},
): string => {
	const out: string[] = [];
	const of = (type: string) => events.filter((event) => event.type === type);
	// Audio levels as one line per track every 5 s: "owner -60 -60 -24 -60 -58".
	const levels = new Map<string, { from: number; db: number[] }>();
	const flush = (who: string) => {
		const level = levels.get(who);
		if (level !== undefined && level.db.length > 0)
			out.push(
				`${clock(level.from)}  level ${short(who)} dBFS/s: ${level.db.join(" ")}`,
			);
		levels.delete(who);
	};
	for (const event of events) {
		if (event.type === "audio.level") {
			const who = String(event.who);
			const level = levels.get(who) ?? { from: event.t, db: [] };
			level.db.push(Number(event.dbfs));
			levels.set(who, level);
			if (level.db.length >= 5) flush(who);
			continue;
		}
		if (all === true && event.type === "stt.interim") {
			out.push(`${clock(event.t)}  ${short(event.who)} ...${event.text}`);
			continue;
		}
		const text = line(event);
		if (text !== null) out.push(`${clock(event.t)}  ${text}`);
	}
	for (const who of [...levels.keys()]) flush(who);

	// Summary.
	const asks = of("turn.ask");
	// First audio after each ask; the session's speaking state carries no turn.
	const answered = asks.flatMap((ask, index): number[] => {
		const next = asks[index + 1]?.t ?? Number.POSITIVE_INFINITY;
		const first = events.find(
			({ type, t }) => type === "tts.first_audio" && t >= ask.t && t < next,
		);
		return first === undefined ? [] : [first.t - ask.t];
	});
	const finals = of("stt.final").filter(({ text }) => Boolean(text)).length;
	// Stopped talking -> the agent's first sound: the delay a caller actually feels.
	const firstWord: number[] = [];
	let quietAt: number | null = null;
	for (const event of events) {
		if (event.type === "user.state" && event.from === "speaking")
			quietAt = event.t;
		else if (event.type === "user.state" && event.to === "speaking")
			quietAt = null;
		else if (
			event.type === "agent.state" &&
			event.to === "speaking" &&
			quietAt !== null
		) {
			firstWord.push(event.t - quietAt);
			quietAt = null;
		}
	}
	const endOfTurn = of("metric.eou").map(({ delay }) => Number(delay));
	const firstByte = of("metric.tts").map(({ ttfb }) => Number(ttfb));
	out.push("");
	out.push(
		`asks ${asks.length}, answered aloud ${answered.length}, interrupts ${of("turn.interrupt").length}`,
	);
	if (answered.length > 0)
		out.push(
			`ask -> first audio: median ${median(answered)} ms, max ${Math.max(...answered)} ms`,
		);
	if (firstWord.length > 0)
		out.push(
			`stopped talking -> first word: median ${median(firstWord)} ms, max ${Math.max(...firstWord)} ms`,
		);
	if (endOfTurn.length > 0)
		out.push(
			`end of turn decided: median ${median(endOfTurn)} ms; tts first byte: median ${median(firstByte)} ms`,
		);
	out.push(
		`stt finals ${finals}, false interruptions ${of("agent.false_interruption").length}`,
	);
	const joins = of("join.failed");
	if (joins.length > 0)
		out.push(
			`JOIN FAILED ${joins.length}x: ${joins.map(({ stage, error }) => `${stage}: ${error}`).join("; ")}`,
		);
	const loop = loopLag(events);
	if (loop !== null)
		out.push(
			`event loop: ${loop.max > 0 ? `max ${loop.max} ms, ${loop.over} stalls over ${loopLimitMs} ms` : `never ${loop.logMs} ms late`}`,
		);
	const droppedMs = sum(of("recording.dropped").map(({ ms }) => Number(ms)));
	const droppedEvents = sum(
		of("log.dropped").map(({ events: count }) => Number(count)),
	);
	if (droppedMs > 0 || droppedEvents > 0)
		out.push(
			`disk too slow: dropped ${droppedMs} ms of recording, ${droppedEvents} events`,
		);
	const errors = events.filter(({ type }) => type.endsWith("error"));
	if (errors.length > 0)
		out.push(
			`errors ${errors.length}: ${[...new Set(errors.map(({ type }) => type))].join(", ")}`,
		);
	return out.join("\n");
};

/** A call's events from its log. A line cut off mid-write is dropped. Undefined if there is no log. */
export const readEvents = async (
	disk: Pick<Disk, "read">,
	path: string,
): Promise<readonly CallEvent[] | undefined> => {
	const text = await disk.read(path);
	return text === undefined ? undefined : parseLines(CallEvent, text);
};

/** The call a full id or a prefix names, among the calls there are. Throws if none or several do. */
export const resolveCall = (ids: readonly string[], call: string): string => {
	if (ids.includes(call)) return call;
	const found = ids.filter((id) => id.startsWith(call));
	const [only] = found;
	if (only === undefined) throw new Error(`no call ${call}`);
	if (found.length > 1)
		throw new Error(`ambiguous call id ${call}: ${found.join(", ")}`);
	return only;
};
