/**
 * The working sound: while the agent's tools run, the room hears typing. It
 * goes out on its voice track, as the head of the reply's next TTS segment,
 * so LiveKit plays it after what it's saying and clears it on a
 * barge-in like any speech. No mixing and no ducking: our only audio code is
 * pacing the clip's frames.
 *
 * Why not LiveKit's BackgroundAudioPlayer: it publishes a second track, and
 * Macro's client plays one publication per person (the microphone), so
 * people would hear nothing of it.
 */
import type { Emit } from "./types.ts";

/** Quicker lookups stay silent, not a flicker. */
export const workingDelayMs = 1000;
/**
 * The clip as shipped: about 18 dB under the voice. Turned down further it
 * reaches the room under anything a laptop plays.
 */
export const clipVolume = 1;
/** What's already sent can't be recalled, so frames are short. */
export const clipFrameMs = 20;
/** "Stop." ends before LiveKit calls it an interruption; don't type into that. */
export const resumeMs = 700;
/** Late by more than this (backpressure), the clip starts its clock again: no burst to catch up. */
const lateMs = 200;

/** What a frame of audio has to say about itself, for pacing. */
export type Paced = {
	readonly samplesPerChannel: number;
	readonly sampleRate: number;
};

/** The samples of a decoded clip cut into frames of `size`, scaled; a short tail is dropped. */
export const clipFrames = (
	samples: Int16Array,
	size: number,
	volume = clipVolume,
): readonly Int16Array[] => {
	const frames: Int16Array[] = [];
	for (let i = 0; i + size <= samples.length; i += size)
		frames.push(samples.slice(i, i + size).map((sample) => sample * volume));
	return frames;
};

/** The brain's working time, held off while someone talks and for a moment after. */
export const unlessTalking = (
	workingSince: () => number | null,
	talking: () => boolean,
	now: () => number,
	resume = resumeMs,
): (() => number | null) => {
	let last = Number.NEGATIVE_INFINITY;
	return () => {
		if (talking()) last = now();
		return now() - last < resume ? null : workingSince();
	};
};

/** A reader of the TTS's frames, whichever ReadableStream it came from (LiveKit's are node's). */
type FrameReader<Frame> = {
	readonly read: () => Promise<{
		readonly done?: boolean;
		readonly value?: Frame;
	}>;
	readonly cancel: (reason?: unknown) => Promise<void>;
};

export type WorkingTime = {
	/** Monotonic milliseconds, the same clock `workingSince` is on. */
	readonly now: () => number;
	readonly sleep: (ms: number) => Promise<void>;
	/** Wall-clock epoch milliseconds, so `sound.start` can be lined up with a recording. */
	readonly wall: () => number;
};

/**
 * One TTS segment. Before its first word, while the brain has been working
 * for over the delay, the clip loops in real time; from the first word on
 * it's the voice. The TTS for the answer opens only once there is text:
 * opened early, a long tool turn hits LiveKit's 10 s TTS read idle timeout
 * and the answer is never spoken.
 */
export const withWorkingSound = <Frame extends Paced>({
	text,
	speak,
	clip,
	workingSince,
	emit,
	time,
	delayMs = workingDelayMs,
}: {
	readonly text: ReadableStream<string>;
	/** The stock TTS, given the segment's words from the first one on. */
	readonly speak: (
		text: ReadableStream<string>,
	) => Promise<ReadableStream<Frame> | null>;
	/** The clip's frames; empty until loaded, and then silence. */
	readonly clip: () => readonly Frame[];
	/** When the brain started working (a tool began), or null when it isn't. */
	readonly workingSince: () => number | null;
	readonly emit: Emit;
	readonly time: WorkingTime;
	readonly delayMs?: number;
}): ReadableStream<Frame> => {
	const words = text.getReader();
	let voice: FrameReader<Frame> | undefined;

	async function* frames(): AsyncGenerator<Frame> {
		let next = words.read();
		let first = "";
		let playing = false;
		let due = 0;
		const stopped = () => {
			// When frames stopped being generated, up to a line ahead of playout: not proof of silence.
			if (playing) emit("sound.stop", { at: time.wall() });
			playing = false;
		};
		for (let i = 0; first === ""; ) {
			const wait = Math.max(1, Math.min(clipFrameMs, due - time.now()));
			const read = await Promise.race([
				next,
				time.sleep(wait).then(() => undefined),
			]);
			if (read?.done === true) {
				stopped();
				return;
			}
			if (read !== undefined) {
				first = read.value;
				next = words.read();
				continue;
			}
			const since = workingSince();
			const now = time.now();
			if (since === null) stopped();
			const loop = clip();
			const frame = loop[i % Math.max(1, loop.length)];
			if (
				since === null ||
				now - since < delayMs ||
				now < due ||
				frame === undefined
			)
				continue;
			if (!playing)
				emit("sound.start", {
					at: time.wall(),
					waitedMs: Math.round(now - since),
				});
			playing = true;
			i++;
			due =
				(now - due > lateMs ? now : due) +
				(1000 * frame.samplesPerChannel) / frame.sampleRate;
			yield frame;
		}
		stopped();
		const opening = first;
		const rest = new ReadableStream<string>({
			start: (controller) => controller.enqueue(opening),
			pull: async (controller) => {
				const read = await next;
				if (read.done) return controller.close();
				controller.enqueue(read.value);
				next = words.read();
			},
			cancel: (why) => words.cancel(why),
		});
		voice = (await speak(rest))?.getReader();
		while (voice !== undefined) {
			const read = await voice.read();
			if (read.done === true || read.value === undefined) return;
			yield read.value;
		}
	}

	const run = frames();
	return new ReadableStream<Frame>(
		{
			pull: async (controller) => {
				const read = await run.next();
				if (read.done) controller.close();
				else controller.enqueue(read.value);
			},
			// A barge-in: LiveKit cancels the segment, and the clip goes with it.
			cancel: async (why) => {
				await words.cancel(why).catch(() => undefined);
				await voice?.cancel(why).catch(() => undefined);
			},
		},
		{ highWaterMark: 0 },
	);
};
