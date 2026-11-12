/**
 * The worker of a share's frame feed (`frames.ts`): decoding stays off the
 * call's thread. The screencast sends a JPEG only when the page changes, so a
 * static page sends one: the newest JPEG is written to ffmpeg again at the
 * frame rate, which keeps the track alive and its rate steady.
 */
import {
	decoderArgv,
	type FromWorker,
	frameBytes,
	ToWorker,
} from "./frames.ts";

// Bun's types don't say this module is a worker.
declare const self: Worker;

const tell = (message: FromWorker, transfer: ArrayBuffer[] = []): void =>
	self.postMessage(message, transfer);

const state: {
	stopped: boolean;
	newest?: Uint8Array;
	timer?: ReturnType<typeof setInterval>;
	end?: () => void;
} = { stopped: false };

/**
 * A process that loaded native libraries (LiveKit's) can carry a library path
 * that makes a nix ffmpeg load the wrong glibc and die.
 */
const { LD_LIBRARY_PATH: _path, LD_PRELOAD: _preload, ...env } = process.env;

const decode = async (
	start: Extract<ToWorker, { kind: "start" }>,
): Promise<void> => {
	const child = Bun.spawn([...decoderArgv(start)], {
		env,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "ignore",
	});
	state.end = () => {
		child.kill();
		void Promise.resolve(child.stdin.end()).catch(() => {});
	};
	tell({ kind: "started", pid: child.pid });
	state.timer = setInterval(() => {
		if (state.newest === undefined || state.stopped) return;
		try {
			child.stdin.write(state.newest);
			void Promise.resolve(child.stdin.flush()).catch(() => {});
		} catch {
			state.stopped = true;
		}
	}, 1000 / start.fps);
	const size = frameBytes(start);
	const frame = new Uint8Array(size);
	let filled = 0;
	try {
		for await (const chunk of child.stdout) {
			if (state.stopped) break;
			let at = 0;
			while (at < chunk.length) {
				const take = Math.min(size - filled, chunk.length - at);
				frame.set(chunk.subarray(at, at + take), filled);
				filled += take;
				at += take;
				if (filled === size) {
					const out = frame.slice().buffer;
					tell({ kind: "frame", data: out }, [out]);
					filled = 0;
				}
			}
		}
	} catch (error) {
		tell({ kind: "error", error: String(error) });
	} finally {
		clearInterval(state.timer);
		tell({ kind: "end" });
	}
};

self.addEventListener("message", ({ data }) => {
	const told = ToWorker.safeParse(data);
	if (!told.success) return;
	const message = told.data;
	if (message.kind === "stop") {
		state.stopped = true;
		clearInterval(state.timer);
		state.end?.();
		tell({ kind: "end" });
	} else if (message.kind === "jpeg") {
		if (!state.stopped) state.newest = new Uint8Array(message.data);
	} else void decode(message);
});
