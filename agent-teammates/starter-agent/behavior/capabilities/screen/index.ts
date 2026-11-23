/**
 * The browser the agent shares from: Chromium on a virtual display,
 * drivable over CDP, with a profile that is never signed in to anything, so
 * a shared screen can't show mail or codes. Why it is built this way is in
 * `DESIGN.md`.
 */
import { behavior } from "@muppet/lib/core/behavior";
import { module } from "@muppet/lib/core/capability";
import type { ScreenContext } from "./context.ts";
import { type MeasureInput, type Measured, measure } from "./measure.ts";
import { type Status, serve, status } from "./screen.ts";

/**
 * Runs the share browser: Xvfb, its sound server and Chromium, restarted when
 * any dies, until killed.
 *
 * The long-lived service, run by systemd as `bin/agent serveScreen`
 * (systemd/agent-screen.service). It doesn't return until it gets SIGTERM or
 * SIGINT, so never call it from a wake or a script: check it with
 * screenStatus, and restart it with `systemctl --user restart agent-screen`. It
 * fails at once if the display is held by a live Xvfb. Its output is how many
 * times it started them.
 */
export const serveScreen = async ({
	screen,
	disk,
	clock,
	shell,
}: ScreenContext): Promise<{ starts: number }> => ({
	starts: await serve({
		config: screen.config,
		disk,
		clock,
		alive: shell.alive,
		start: screen.start,
		stopped: screen.stopped(),
		log: screen.log,
	}),
});

/**
 * Whether the share browser is up, and how to reach it.
 *
 * `up` is false when its DevTools port doesn't answer. `cdp` is where it's
 * driven (loopback only): Playwright's connectOverCDP, or any CDP client. A
 * new or front tab is what the display shows. Its profile has no logins and
 * must stay that way: signing it into anything puts that account on a shared
 * screen, and the profile persists. `frames` is the format of the display's
 * raw frames: I420. The browser's sound goes to a private PulseAudio sink,
 * which a share records.
 */
export const screenStatus = ({ screen }: ScreenContext): Promise<Status> =>
	status({ config: screen.config, get: screen.get });

/** The longest a measurement runs, and the most frames a second it asks for. */
const mostSeconds = 600;
const mostFps = 60;

/** Refuses a number given that isn't above 0 and at most `most`. */
const upTo = (value: number | undefined, most: number, what: string): void => {
	if (value !== undefined && !(value > 0 && value <= most))
		throw new Error(
			`${what} must be above 0 and at most ${most}, not ${value}`,
		);
};

/**
 * Measures the share browser's frames and latency: the check after any change
 * to it.
 *
 * Opens a tab, animates it, and reads real frames off the display for
 * `seconds` (15 by default, after 2 of warmup; at most 600), at `fps` (the
 * display's by default; at most 60). `scene` is `light` (a
 * rotating box) or `busy` (3000 dots); `url` scrolls that page instead.
 * `slowMs` (not negative) waits between frames, as a reader that can't keep up: it should
 * lose frames, not gain latency. `latencyMs` is from the page stamping the
 * time into its pixels to the frame in the reader's hands. `deliveredFps`
 * counts frames read, `distinctFps` frames that showed a new page frame, and
 * `cores` what each part cost. Healthy at 1080p30: 30 and 30, p50 around
 * 50-65 ms, ffmpeg and reader near 0.2 cores each. The screen must be up
 * (screenStatus).
 */
export const measureScreen = (
	{ screen, clock }: ScreenContext,
	input: MeasureInput = {},
): Promise<Measured> => {
	upTo(input.seconds, mostSeconds, "seconds");
	upTo(input.fps, mostFps, "fps");
	if (input.slowMs !== undefined && !(input.slowMs >= 0))
		throw new Error(`slowMs must not be negative, not ${input.slowMs}`);
	return measure(
		{
			config: screen.config,
			clock,
			tab: screen.tab,
			capture: screen.capture,
			processes: screen.processes,
			ownCpu: screen.ownCpu,
			save: screen.save,
		},
		input,
	);
};

/** `screen` is the context's own value, so the module can't have the name. */
export const screenModule = module({
	name: "screen",
	summary:
		"The browser you share from on a call: run it, check it is up, and measure its frames and latency.",
	file: import.meta.path,
	functions: { serveScreen, screenStatus, measureScreen },
});

export const screenCapabilities =
	behavior<ScreenContext>().capability(screenModule);
