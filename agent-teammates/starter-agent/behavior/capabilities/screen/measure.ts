/**
 * Measuring capture: the page stamps the time into its pixels, the reader
 * decodes it from the frame it got. That's end-to-end latency, on real
 * frames. `measure` is the check after any change to the screen.
 */
import type { Clock } from "@muppet/lib/utilities/time";
import type { ScreenConfig } from "./config.ts";
import type { Capture } from "./screen.ts";

const bits = 40;
const timeBits = 32;
const strip = 16;
const wrap = 2 ** timeBits;
const lumaMiddle = 128;

const check = (stamp: number): number =>
	(stamp ^ (stamp >>> 8) ^ (stamp >>> 16) ^ (stamp >>> 24)) & 0xff;

/** The 40 bits a timestamp is drawn as: 32 of milliseconds, 8 of check, so a torn stamp reads as torn. */
export const stampBits = (ms: number): readonly number[] => {
	const stamp = ms % wrap;
	const sum = check(stamp);
	return [
		...Array.from(
			{ length: timeBits },
			(_, i) => Math.floor(stamp / 2 ** (timeBits - 1 - i)) % 2,
		),
		...Array.from({ length: bits - timeBits }, (_, i) => (sum >> (7 - i)) & 1),
	];
};

/** Reads a stamp from an I420 frame's luma plane. Null when it's torn or absent. */
export const readStamp = (frame: Uint8Array, width: number): number | null => {
	const block = Math.floor(width / bits);
	const row = (strip >> 1) * width;
	let stamp = 0;
	let sum = 0;
	for (let i = 0; i < bits; i++) {
		const on =
			(frame[row + Math.floor((i + 0.5) * block)] ?? 0) > lumaMiddle ? 1 : 0;
		if (i < timeBits) stamp = stamp * 2 + on;
		else sum = sum * 2 + on;
	}
	return sum === check(stamp) ? stamp : null;
};

/** Milliseconds from stamp to now, on the 32-bit clock. */
export const age = (nowMs: number, stamp: number): number =>
	((nowMs % wrap) - stamp + wrap) % wrap;

export type Sample = { readonly at: number; readonly stamp: number | null };

export type Summary = {
	readonly frames: number;
	/** Frames read a second. */
	readonly deliveredFps: number;
	/** Frames a second that showed a new page frame. */
	readonly distinctFps: number;
	readonly torn: number;
	readonly latencyMs: {
		readonly p50: number | null;
		readonly p95: number | null;
		readonly max: number | null;
	};
};

const percentile = (sorted: readonly number[], part: number): number | null =>
	sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * part))] ?? null;

const tenth = (value: number): number => Math.round(value * 10) / 10;

/** Delivered fps counts frames read; distinct fps counts frames that showed a new page frame. */
export const summarize = (samples: readonly Sample[]): Summary => {
	const [first, last] = [samples.at(0), samples.at(-1)];
	if (first === undefined || last === undefined || samples.length < 2)
		return {
			frames: samples.length,
			deliveredFps: 0,
			distinctFps: 0,
			torn: 0,
			latencyMs: { p50: null, p95: null, max: null },
		};
	const seconds = (last.at - first.at) / 1000;
	const latencies = samples
		.flatMap(({ at, stamp }) => (stamp === null ? [] : [age(at, stamp)]))
		.sort((a, b) => a - b);
	const distinct = new Set(
		samples.flatMap(({ stamp }) => (stamp === null ? [] : [stamp])),
	).size;
	return {
		frames: samples.length,
		deliveredFps: tenth((samples.length - 1) / seconds),
		distinctFps: tenth(distinct / seconds),
		torn: samples.length - latencies.length,
		latencyMs: {
			p50: percentile(latencies, 0.5),
			p95: percentile(latencies, 0.95),
			max: latencies.at(-1) ?? null,
		},
	};
};

export type Scene = "light" | "busy" | "scroll";

const busyDots = 3000;

/** Runs in the page: the stamp strip on top of whatever's there, plus motion. */
export const overlayScript = (
	scene: Scene,
	frameWidth: number,
): string => `(() => {
  const W = innerWidth, H = innerHeight, block = ${Math.floor(frameWidth / bits)};
  const c = document.createElement('canvas');
  c.width = W; c.height = ${scene === "busy" ? "H" : strip};
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none';
  document.documentElement.appendChild(c);
  const g = c.getContext('2d');
  const check = (t) => (t ^ (t >>> 8) ^ (t >>> 16) ^ (t >>> 24)) & 255;
  const dots = Array.from({ length: ${scene === "busy" ? busyDots : 0} }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, a: i }));
  let box = null;
  ${scene === "light" ? "box = document.createElement('div'); box.style.cssText = 'position:fixed;left:40%;top:40%;width:200px;height:200px;background:#e63'; document.documentElement.appendChild(box);" : ""}
  const tick = (n) => {
    if (dots.length) {
      g.fillStyle = '#123'; g.fillRect(0, 0, W, H);
      for (const d of dots) {
        d.x = (d.x + Math.cos(d.a + n / 900) * 3 + W) % W; d.y = (d.y + Math.sin(d.a + n / 700) * 3 + H) % H;
        g.fillStyle = 'hsl(' + (d.a + n / 9) % 360 + ',80%,60%)'; g.beginPath(); g.arc(d.x, d.y, 9, 0, 7); g.fill();
      }
    }
    if (box) box.style.transform = 'rotate(' + n / 5 + 'deg)';
    ${scene === "scroll" ? "scrollBy(0, 4); if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) scrollTo(0, 0);" : ""}
    const t = Date.now() % 4294967296, sum = check(t);
    for (let i = 0; i < ${bits}; i++) {
      const on = i < 32 ? Math.floor(t / 2 ** (31 - i)) % 2 : (sum >> (39 - i)) & 1;
      g.fillStyle = on ? '#fff' : '#000'; g.fillRect(i * block, 0, block, ${strip});
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

/** One process, as the kernel lists it. */
export type Process = {
	readonly pid: number;
	readonly parent: number;
	/** CPU ticks used, user and system. */
	readonly ticks: number;
	/** Its command line as one string: Chromium rewrites its title, so there is no argv to match. */
	readonly command: string;
};

/** A process and everything it started. */
export const treeOf = (
	all: readonly Process[],
	root: number,
): ReadonlySet<number> => {
	const pids = new Set([root]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const { pid, parent } of all)
			if (pids.has(parent) && !pids.has(pid)) {
				pids.add(pid);
				grew = true;
			}
	}
	return pids;
};

/** The CPU ticks of a process and its descendants. Zero if it isn't known. */
export const treeTicks = (
	all: readonly Process[],
	root: number | undefined,
): number => {
	if (root === undefined) return 0;
	const tree = treeOf(all, root);
	return all.reduce(
		(sum, { pid, ticks }) => (tree.has(pid) ? sum + ticks : sum),
		0,
	);
};

/** A tab of the share browser, opened in front, for the measurement to animate. */
export type Tab = {
	readonly send: (method: string, params?: object) => Promise<unknown>;
	readonly close: () => Promise<void>;
};

export type MeasurePorts = {
	readonly config: ScreenConfig;
	readonly clock: Clock;
	readonly tab: (url: string) => Promise<Tab>;
	readonly capture: (fps: number) => Capture;
	readonly processes: () => readonly Process[];
	/** CPU seconds this process has used. */
	readonly ownCpu: () => number;
	readonly save: (path: string, frame: Uint8Array) => Promise<void>;
};

export type MeasureInput = {
	readonly scene?: "light" | "busy";
	/** Scroll this page instead of a scene. */
	readonly url?: string;
	/** Above 0, at most 600. */
	readonly seconds?: number;
	/** Above 0, at most 60. */
	readonly fps?: number;
	/** Wait this long between frames, as a reader that can't keep up. Not negative. */
	readonly slowMs?: number;
	/** Write one raw I420 frame to this file. */
	readonly save?: string;
};

export type Measured = Summary & {
	readonly scene: Scene;
	readonly url?: string;
	readonly size: string;
	readonly askedFps: number;
	readonly slowMs: number;
	/** Cores used over the measurement, by each part. */
	readonly cores: {
		readonly chromium: number;
		readonly xvfb: number;
		readonly ffmpeg: number;
		readonly reader: number;
	};
};

const blankPage = 'data:text/html,<body style="margin:0;background:%23345">';
const defaultSeconds = 15;
const warmupMs = 2_000;
const pageLoads = 4_000;
const settles = 1_000;
/** Clock ticks a second on Linux. */
const ticksPerSecond = 100;

const hundredth = (value: number): number => Math.round(value * 100) / 100;

/**
 * Opens a tab, animates it, and reads real frames off the display: frames a
 * second, latency from the page's stamp to the reader's hands, and what each
 * part cost in CPU.
 */
export const measure = async (
	{ config, clock, tab, capture, processes, ownCpu, save }: MeasurePorts,
	input: MeasureInput = {},
): Promise<Measured> => {
	const seconds = input.seconds ?? defaultSeconds;
	const fps = input.fps ?? config.fps;
	const slowMs = input.slowMs ?? 0;
	const scene: Scene =
		input.url === undefined ? (input.scene ?? "light") : "scroll";
	const now = (): number => clock.now().epochMilliseconds;

	const page = await tab(input.url ?? blankPage);
	await clock.sleep(input.url === undefined ? settles : pageLoads);
	await page.send("Runtime.evaluate", {
		expression: overlayScript(scene, config.width),
	});
	await clock.sleep(settles);

	const camera = capture(fps);
	const all = processes();
	const roots = {
		chromium: all.find(
			({ command }) =>
				command.includes(`--remote-debugging-port=${config.cdpPort}`) &&
				!command.includes("--type="),
		)?.pid,
		xvfb: all.find(({ command }) =>
			command.includes(`${config.xvfb} ${config.display} `),
		)?.pid,
		ffmpeg: camera.pid,
	};
	const ticks = () => {
		const current = processes();
		return {
			chromium: treeTicks(current, roots.chromium),
			xvfb: treeTicks(current, roots.xvfb),
			ffmpeg: treeTicks(current, roots.ffmpeg),
		};
	};

	const samples: Sample[] = [];
	const warm = now() + warmupMs;
	const end = warm + seconds * 1000;
	let began: { at: number; ticks: ReturnType<typeof ticks>; cpu: number } = {
		at: now(),
		ticks: ticks(),
		cpu: ownCpu(),
	};
	let counting = false;
	let saved = false;
	try {
		for await (const frame of camera.frames()) {
			const at = now();
			if (at < warm) continue;
			if (!counting) {
				counting = true;
				began = { at, ticks: ticks(), cpu: ownCpu() };
			}
			samples.push({ at, stamp: readStamp(frame, config.width) });
			if (input.save !== undefined && !saved && samples.length > fps) {
				await save(input.save, frame);
				saved = true;
			}
			if (at >= end) break;
			if (slowMs > 0) await clock.sleep(slowMs);
		}
	} finally {
		camera.stop();
		await page.close().catch(() => undefined);
	}
	const after = ticks();
	const elapsed = Math.max((now() - began.at) / 1000, 0.001);
	const cores = (used: number): number =>
		hundredth(used / ticksPerSecond / elapsed);
	return {
		scene,
		url: input.url,
		size: `${config.width}x${config.height}`,
		askedFps: fps,
		slowMs,
		...summarize(samples),
		cores: {
			chromium: cores(after.chromium - began.ticks.chromium),
			xvfb: cores(after.xvfb - began.ticks.xvfb),
			ffmpeg: cores(after.ffmpeg - began.ticks.ffmpeg),
			reader: hundredth((ownCpu() - began.cpu) / elapsed),
		},
	};
};
