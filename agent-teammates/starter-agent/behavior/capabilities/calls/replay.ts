/**
 * Replay: recorded audio through the real session (VAD, STT, turn detection)
 * and the agent's turns, with a stub brain that answers at once and no voice.
 * It says what the agent would have been asked. Recordings stay in the call's log:
 * people's voices never go in the repository.
 */
import { frames, type Pcm } from "./audio.ts";
import type { Brain } from "./brain.ts";
import { fileName } from "./config.ts";
import { frameMs, agentVoice } from "./room.ts";

/** A brain that answers "Okay." at once and reports what it was asked. */
export const stubBrain = (onAsk: (content: string) => void): Brain => ({
	start: async () => undefined,
	ask: async function* (_turn, content) {
		onAsk(content);
		yield "Okay.";
	},
	interrupt: () => undefined,
	close: async () => undefined,
});

/** A session whose microphone is fed by hand. */
export type ReplaySession = {
	/** One frame of 16-bit mono PCM into the session's ears. */
	readonly push: (frame: Int16Array, rate: number) => void;
	readonly close: () => Promise<void>;
};

/** Who is talking in a replay: one caller, alone with the agent. */
export const replaySpeakers = {
	humans: () => 1,
	current: () => ["replay", "Caller"] as const,
};

/** Silence after the recording, so the last turn can end. */
export const tailMs = 4000;

/** Feeds a recording to a session in real time, then closes it. */
export const replay = async ({
	pcm: { rate, samples },
	session,
	monotonic,
	sleep,
	tail = tailMs,
}: {
	readonly pcm: Pcm;
	readonly session: ReplaySession;
	readonly monotonic: () => number;
	readonly sleep: (ms: number) => Promise<void>;
	readonly tail?: number;
}): Promise<void> => {
	const all = new Int16Array(samples.length + (tail / 1000) * rate);
	all.set(samples);
	const started = monotonic();
	let sent = 0;
	for (const frame of frames(all, (rate * frameMs) / 1000)) {
		// A copy: frames() yields views of one buffer.
		session.push(frame.slice(), rate);
		const wait = started + ++sent * frameMs - monotonic();
		if (wait > 0) await sleep(wait);
	}
	await session.close();
};

const recording = ".wav";
/** The agent's own voice and a mixdown aren't what it heard. */
const notHeard: readonly string[] = [agentVoice, "mix"].map(
	(who) => `${fileName(who)}${recording}`,
);

export const isRecording = (path: string): boolean => path.endsWith(recording);

/** The recordings in a call's directory that are someone the agent heard. */
export const heardRecordings = (names: readonly string[]): readonly string[] =>
	names.filter((name) => isRecording(name) && !notHeard.includes(name));

/** The one call id that is, or starts with, what was given. */
export const resolveCall = (given: string, ids: readonly string[]): string => {
	if (ids.includes(given)) return given;
	const matching = ids.filter((id) => id.startsWith(given));
	const [only] = matching;
	if (only === undefined) throw new Error(`no call ${given}`);
	if (matching.length > 1)
		throw new Error(`ambiguous call id ${given}: ${matching.join(", ")}`);
	return only;
};

/** The line said to the agent in what the brain was sent. */
export const askedLine = (content: string): string =>
	content.replace(/^[\s\S]*says to you: /, "");
