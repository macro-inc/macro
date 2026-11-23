/**
 * The share browser's settings: which display and port it is on, what it
 * runs, and where it keeps things. Nothing else in the area names a program,
 * a port or a path.
 */
import type { State } from "../../context/state.ts";

/** The owner of the screen's state directories. */
export const owner = "screen";

/** The capability the service runs: `bin/agent serveScreen`. */
export const serveCapability = "serveScreen";

/**
 * The environment variable that lists font directories, separated by colons.
 * The flake's shell sets it to pinned Noto CJK and emoji: the system's fonts
 * alone draw both as boxes.
 */
export const fontsVariable = "AGENT_SCREEN_FONTS";

export type ScreenConfig = {
	/** The X display, e.g. `:96`. */
	readonly display: string;
	/** Chromium's DevTools port, on loopback only. */
	readonly cdpPort: number;
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	/** Programs, by the names the flake's shell has on PATH. */
	readonly xvfb: string;
	readonly chromium: string;
	/** An ffmpeg with x11grab: `ffmpeg` and `ffmpeg-headless` are built without it. */
	readonly ffmpeg: string;
	/** The browser's own sound server, and what records from it. */
	readonly pulseaudio: string;
	readonly parec: string;
	/** Where the browser's sound goes: one sink on a private PulseAudio, nobody's speakers. */
	readonly sound: {
		/** Its runtime directory; nothing in it survives a restart. */
		readonly directory: string;
		/** Its socket, which Chromium plays into and `parec` records from. */
		readonly socket: string;
		readonly sink: string;
		readonly rate: number;
		readonly channels: number;
	};
	/** Directories of fonts added to the system's. */
	readonly fonts: readonly string[];
	readonly extraFlags: readonly string[];
	/** Chromium's profile. It holds no logins and stays that way: a login would be on the shared screen. */
	readonly profile: string;
	/** The fontconfig file written at start. */
	readonly fontsFile: string;
	/** The system's fontconfig, which ours includes. */
	readonly systemFonts: string;
	/** Xvfb's lock and socket for the display. A killed Xvfb leaves both behind. */
	readonly lock: string;
	readonly socket: string;
	/** Where the kernel lists processes. */
	readonly processes: string;
};

/**
 * A display and port well clear of the low numbers desktops and other
 * virtual displays usually take. A display held by a container shows only as
 * an abstract socket (its /tmp isn't ours, so there is no lock file to see),
 * and Xvfb refuses it: if the screen won't start for that reason, choose
 * another here.
 */
const display = ":96";
const cdpPort = 9335;

const profileDirectory = "profile";
const soundDirectory = "sound";
const soundSocket = "native";
const fontsFileName = "fonts.conf";
const systemFonts = "/etc/fonts/fonts.conf";
const temporary = "/tmp";
const socketDirectory = ".X11-unix";
const processes = "/proc";

/** The number of a display: `:96` is 96. */
export const displayNumber = (name: string): string => name.replace(":", "");

export const screenConfig = ({
	state,
	join,
	fonts = [],
}: {
	readonly state: Pick<State, "private" | "run">;
	readonly join: (...parts: readonly string[]) => string;
	readonly fonts?: readonly string[];
}): ScreenConfig => ({
	display,
	cdpPort,
	width: 1920,
	height: 1080,
	fps: 30,
	xvfb: "Xvfb",
	chromium: "chromium",
	ffmpeg: "ffmpeg-x11grab",
	pulseaudio: "pulseaudio",
	parec: "parec",
	sound: {
		directory: join(state.run(owner), soundDirectory),
		socket: join(state.run(owner), soundDirectory, soundSocket),
		sink: "share",
		rate: 48_000,
		channels: 2,
	},
	fonts,
	extraFlags: [],
	profile: join(state.private(owner), profileDirectory),
	fontsFile: join(state.run(owner), fontsFileName),
	systemFonts,
	lock: join(temporary, `.X${displayNumber(display)}-lock`),
	socket: join(temporary, socketDirectory, `X${displayNumber(display)}`),
	processes,
});

/** The font directories in the variable's value. */
export const fontDirectories = (value: string | undefined): readonly string[] =>
	(value ?? "").split(":").filter((directory) => directory !== "");

/** Where the browser's DevTools answer. Loopback only. */
export const cdpAddress = (port: number): string => `http://127.0.0.1:${port}`;
