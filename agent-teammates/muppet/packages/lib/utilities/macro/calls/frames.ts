/**
 * A share's frames: the screencast's JPEGs go to a worker, which decodes them
 * with ffmpeg, and fixed-size I420 frames come back for the call's track. A
 * worker, because the call's thread must never wait on decoding: it would be
 * heard in the agent's voice.
 */
import type { ScreenFrame } from "@macro-inc/sdk/calls/node";
import { z } from "zod";

/** What a share looks like on the wire. 10 fps: a page, not a video. */
export type Settings = {
	readonly fps: number;
	readonly width: number;
	readonly height: number;
	/** The screencast's JPEG quality, 0 to 100. */
	readonly quality: number;
};

export const settings: Settings = {
	fps: 10,
	width: 1280,
	height: 720,
	quality: 65,
};

/** I420: a full luma plane, then two quarter-size chroma planes. */
export const frameBytes = ({
	width,
	height,
}: Pick<Settings, "width" | "height">): number => (width * height * 3) / 2;

/** What the feed tells its worker. */
export const ToWorker = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("start"),
		ffmpeg: z.string(),
		width: z.number(),
		height: z.number(),
		fps: z.number(),
	}),
	z.object({ kind: z.literal("jpeg"), data: z.instanceof(ArrayBuffer) }),
	z.object({ kind: z.literal("stop") }),
]);
export type ToWorker = z.infer<typeof ToWorker>;

/** What the worker tells the feed. */
export const FromWorker = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("started"), pid: z.number() }),
	z.object({ kind: z.literal("frame"), data: z.instanceof(ArrayBuffer) }),
	z.object({ kind: z.literal("end") }),
	z.object({ kind: z.literal("error"), error: z.string() }),
]);
export type FromWorker = z.infer<typeof FromWorker>;

/** JPEGs on stdin, raw I420 of one size and rate on stdout. */
export const decoderArgv = ({
	ffmpeg,
	width,
	height,
	fps,
}: Extract<ToWorker, { kind: "start" }>): readonly string[] => [
	ffmpeg,
	"-hide_banner",
	"-loglevel",
	"error",
	"-nostdin",
	// Without these ffmpeg reads seconds of input before its first frame.
	"-fflags",
	"nobuffer",
	"-probesize",
	"32",
	"-analyzeduration",
	"0",
	"-f",
	"image2pipe",
	"-framerate",
	String(fps),
	"-c:v",
	"mjpeg",
	"-i",
	"pipe:0",
	"-vf",
	`fps=${fps},scale=${width}:${height}`,
	"-an",
	"-pix_fmt",
	"yuv420p",
	"-f",
	"rawvideo",
	"pipe:1",
];

/**
 * Holds only the newest frame: a reader that falls behind loses frames, never
 * time.
 */
export const latestFrameQueue = (width: number, height: number) => {
	const state: { newest?: Uint8Array; wake?: () => void; ended: boolean } = {
		ended: false,
	};
	const end = (): void => {
		state.ended = true;
		state.newest = undefined;
		state.wake?.();
	};
	return {
		push: (data: Uint8Array): void => {
			if (state.ended) return;
			state.newest = data;
			state.wake?.();
		},
		stop: end,
		[Symbol.asyncIterator]: (): AsyncIterator<ScreenFrame> => ({
			next: async () => {
				while (state.newest === undefined && !state.ended)
					await new Promise<void>((resolve) => {
						state.wake = resolve;
					});
				const data = state.newest;
				if (state.ended || data === undefined)
					return { done: true, value: undefined };
				state.newest = undefined;
				return { done: false, value: { data, width, height, format: "I420" } };
			},
			return: async () => {
				end();
				return { done: true, value: undefined };
			},
		}),
	};
};

/** JPEGs in, I420 frames for the track out. */
export type FrameFeed = AsyncIterable<ScreenFrame> & {
	readonly jpeg: (data: ArrayBuffer) => void;
	readonly stop: () => Promise<void>;
};

const worker = "./decoder.ts";
const endsWithin = 500;

/** Decodes in a worker, with `ffmpeg` (any build that reads JPEG). */
export const frameFeed = ({
	ffmpeg = "ffmpeg",
	width,
	height,
	fps,
}: Pick<Settings, "width" | "height" | "fps"> & {
	readonly ffmpeg?: string;
}): FrameFeed => {
	const frames = new Worker(new URL(worker, import.meta.url));
	const queue = latestFrameQueue(width, height);
	const state: { pid?: number; ended: boolean; onEnd?: () => void } = {
		ended: false,
	};
	const end = (): void => {
		state.ended = true;
		queue.stop();
		state.onEnd?.();
	};
	const tell = (message: ToWorker, transfer: ArrayBuffer[] = []): void =>
		frames.postMessage(message, transfer);
	frames.addEventListener("message", ({ data }) => {
		const told = FromWorker.safeParse(data);
		if (!told.success) return;
		if (told.data.kind === "started") state.pid = told.data.pid;
		else if (told.data.kind === "frame")
			queue.push(new Uint8Array(told.data.data));
		else end();
	});
	frames.addEventListener("error", end);
	tell({ kind: "start", ffmpeg, width, height, fps });
	return {
		jpeg: (data) => tell({ kind: "jpeg", data }, [data]),
		stop: async () => {
			queue.stop();
			if (!state.ended) {
				tell({ kind: "stop" });
				await Promise.race([
					new Promise<void>((resolve) => {
						state.onEnd = resolve;
					}),
					Bun.sleep(endsWithin),
				]);
			}
			// A worker that didn't answer may have left its ffmpeg behind.
			if (!state.ended && state.pid !== undefined)
				try {
					process.kill(state.pid);
				} catch {}
			frames.terminate();
		},
		[Symbol.asyncIterator]: () => queue[Symbol.asyncIterator](),
	};
};
