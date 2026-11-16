import { expect, test } from "bun:test";
import { clipFrames, unlessTalking, withWorkingSound } from "../working.ts";

type Mark = "clip" | "voice";
type Frame = {
	readonly mark: Mark;
	readonly samplesPerChannel: number;
	readonly sampleRate: number;
};
/** 10 ms of audio. */
const frame = (mark: Mark): Frame => ({
	mark,
	samplesPerChannel: 240,
	sampleRate: 24000,
});

/** Lets everything that is ready to run, run. */
const settle = () =>
	new Promise<void>((resolve) => {
		setImmediate(resolve);
	});

/** Time moved by hand: a sleep ends when the test moves past it. */
const manualTime = () => {
	let at = 0;
	let sleepers: { readonly until: number; readonly wake: () => void }[] = [];
	return {
		now: () => at,
		wall: () => at,
		sleep: (ms: number) =>
			new Promise<void>((wake) => {
				sleepers.push({ until: at + ms, wake });
			}),
		move: async (ms: number) => {
			const target = at + ms;
			for (;;) {
				await settle();
				const next = Math.min(...sleepers.map(({ until }) => until));
				if (next > target) break;
				at = next;
				const due = sleepers.filter(({ until }) => until <= at);
				sleepers = sleepers.filter(({ until }) => until > at);
				for (const { wake } of due) wake();
			}
			at = target;
			await settle();
		},
	};
};

/** A segment driven by hand: push its text, watch its frames in order. */
const segment = (options: { working?: boolean; delayMs?: number } = {}) => {
	const time = manualTime();
	const words = new TransformStream<string, string>();
	const text = words.writable.getWriter();
	const spoken: string[] = [];
	const events: string[] = [];
	let since: number | null = options.working === false ? null : 0;
	const speak = async (rest: ReadableStream<string>) =>
		new ReadableStream<Frame>({
			pull: async (controller) => {
				const read = await rest.getReader().read();
				if (read.done) return controller.close();
				spoken.push(read.value);
				controller.enqueue(frame("voice"));
				controller.close();
			},
		});
	const audio = withWorkingSound({
		text: words.readable,
		speak,
		clip: () => [frame("clip")],
		workingSince: () => since,
		emit: (type) => events.push(type),
		time,
		delayMs: options.delayMs ?? 30,
	});
	const got: Mark[] = [];
	const reader = audio.getReader();
	const done = (async () => {
		for (;;) {
			const read = await reader.read();
			if (read.done) return;
			got.push(read.value.mark);
		}
	})();
	return {
		text,
		got,
		events,
		spoken,
		reader,
		time,
		/** Runs the segment to its end. */
		finish: async () => {
			await time.move(100);
			await done;
		},
		stopWorking: () => {
			since = null;
		},
	};
};

test("a plain reply never hears the clip", async () => {
	const s = segment({ working: false });
	void s.text.write("Hello.");
	void s.text.close();
	await s.finish();
	expect(s.got).toEqual(["voice"]);
	expect(s.spoken).toEqual(["Hello."]);
	expect(s.events).toEqual([]);
});

test("a lookup shorter than the delay is silent", async () => {
	const s = segment({ delayMs: 200 });
	void s.text.write("");
	await s.time.move(50);
	void s.text.write("Found it.");
	void s.text.close();
	await s.finish();
	expect(s.got).toEqual(["voice"]);
	expect(s.events).toEqual([]);
});

test("work past the delay loops the clip until its first word, then only voice", async () => {
	const s = segment();
	void s.text.write("");
	await s.time.move(150);
	s.stopWorking();
	void s.text.write("Found it.");
	void s.text.close();
	await s.finish();
	expect(s.got.filter((mark) => mark === "clip").length).toBeGreaterThan(3);
	expect(s.got.indexOf("voice")).toBe(s.got.length - 1);
	expect(s.events).toEqual(["sound.start", "sound.stop"]);
	expect(s.spoken).toEqual(["Found it."]);
});

test("the clip plays in real time, not as fast as it is read", async () => {
	const s = segment({ delayMs: 0 });
	void s.text.write("");
	await s.time.move(200);
	void s.text.close();
	await s.finish();
	// 10 ms frames over 200 ms: never a flood.
	expect(s.got.length).toBeGreaterThan(10);
	expect(s.got.length).toBeLessThanOrEqual(21);
});

test("work ending without a word stops the clip and closes the segment", async () => {
	const s = segment();
	void s.text.write("");
	await s.time.move(80);
	void s.text.close();
	await s.finish();
	expect(s.got.length).toBeGreaterThan(0);
	expect(s.got.every((mark) => mark === "clip")).toBe(true);
	expect(s.events).toEqual(["sound.start", "sound.stop"]);
});

test("a barge-in cancels the segment and the clip with it", async () => {
	const s = segment();
	void s.text.write("");
	await s.time.move(80);
	await s.reader.cancel();
	const heard = s.got.length;
	expect(heard).toBeGreaterThan(0);
	await s.time.move(60);
	expect(s.got.length).toBe(heard);
});

test('no sound while someone talks, or just after: "Stop." ends before the interruption does', () => {
	let at = 0;
	let talking = false;
	const since = unlessTalking(
		() => 5,
		() => talking,
		() => at,
		700,
	);
	expect(since()).toBe(5);
	talking = true;
	at = 100;
	expect(since()).toBeNull();
	talking = false;
	at = 500;
	expect(since()).toBeNull();
	at = 800;
	expect(since()).toBe(5);
});

test("the clip is cut into whole frames at its level", () => {
	const frames = clipFrames(Int16Array.from([100, 200, 300, 400, 500]), 2, 0.5);
	expect(frames.map((samples) => [...samples])).toEqual([
		[50, 100],
		[150, 200],
	]);
});
