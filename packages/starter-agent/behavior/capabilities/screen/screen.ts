/**
 * The share browser: what to run, how to keep it running, and how to read
 * its frames. Everything here is pure or works over ports; the real ones are
 * built in `context.ts`. Why each choice was made is in `DESIGN.md`.
 */
import type { Clock } from '@macro-inc/muppet/utilities/time';
import { z } from 'zod';
import type { Disk } from '../../context/disk.ts';
import type { Started } from '../../context/shell.ts';
import { cdpAddress, type ScreenConfig } from './config.ts';

type Size = Pick<ScreenConfig, 'width' | 'height'>;

/** I420: a full luma plane, then two quarter-size chroma planes. */
export const frameBytes = ({ width, height }: Size): number =>
  (width * height * 3) / 2;

/**
 * Whatever launched us can leak a library path (the flake's shell sets one
 * for LiveKit, and this machine's agents carry another): a nix binary then
 * loads the wrong glibc and dies. Chromium and ffmpeg both did, on GLIBC_2.43.
 */
export const cleanEnv = (
  env: Readonly<Record<string, string | undefined>>,
  display: string
): Record<string, string | undefined> => {
  const { LD_LIBRARY_PATH: _path, LD_PRELOAD: _preload, ...rest } = env;
  return { ...rest, DISPLAY: display };
};

/** The system's fontconfig plus our pinned fonts. */
export const fontsConf = (
  system: string,
  directories: readonly string[]
): string => `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">${system}</include>
${directories.map((directory) => `  <dir>${directory}</dir>`).join('\n')}
</fontconfig>
`;

export const xvfbArgv = (screen: ScreenConfig): readonly string[] => [
  screen.xvfb,
  screen.display,
  '-screen',
  '0',
  `${screen.width}x${screen.height}x24`,
  '-nolisten',
  'tcp',
];

/**
 * The browser's sound server: PulseAudio with no config of its own, one
 * socket, and one null sink, so a page's sound goes somewhere a share can
 * record it and nowhere else. Xvfb has no audio; without this Chromium plays
 * into nothing.
 */
export const pulseArgv = ({
  pulseaudio,
  sound,
}: ScreenConfig): readonly string[] => [
  pulseaudio,
  '--daemonize=no',
  '-n',
  '--exit-idle-time=-1',
  '--use-pid-file=no',
  '--realtime=no',
  '--high-priority=no',
  '--disable-shm=yes',
  '--log-target=stderr',
  '--log-level=warning',
  '-L',
  `module-native-protocol-unix socket=${sound.socket} auth-anonymous=1 auth-cookie-enabled=0`,
  '-L',
  `module-null-sink sink_name=${sound.sink} rate=${sound.rate} channels=${sound.channels}`,
];

/** Keeps the sound server's state in its own directory, never the user's. */
export const pulseEnv = ({ sound }: ScreenConfig): Record<string, string> => ({
  PULSE_RUNTIME_PATH: sound.directory,
  PULSE_STATE_PATH: sound.directory,
});

/** What tells Chromium, or anything else, where the browser's sound server is. */
export const soundServer = ({ sound }: ScreenConfig): string =>
  `unix:${sound.socket}`;

/** The sink's sound as raw s16le PCM on stdout, interleaved, at the sink's rate and channels. */
export const recordArgv = (
  { parec, sound }: ScreenConfig,
  latencyMs: number
): readonly string[] => [
  parec,
  `--server=unix:${sound.socket}`,
  `--device=${sound.sink}.monitor`,
  '--raw',
  '--format=s16le',
  `--rate=${sound.rate}`,
  `--channels=${sound.channels}`,
  `--latency-msec=${latencyMs}`,
];

/** Sandbox on, CDP on loopback (Chromium's default bind). No browser UI: the share shows the page, never a URL bar. */
export const chromiumArgv = (screen: ScreenConfig): readonly string[] => [
  screen.chromium,
  `--user-data-dir=${screen.profile}`,
  `--remote-debugging-port=${screen.cdpPort}`,
  '--kiosk',
  '--window-position=0,0',
  // With no window manager an exact fit comes out 1px short and shows a black edge.
  `--window-size=${screen.width + 1},${screen.height + 1}`,
  '--force-device-scale-factor=1',
  '--lang=en-US',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-crash-restore-bubble',
  '--password-store=basic',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=Translate',
  // WebGL through SwiftShader, for pages that need it; the page itself stays on the software compositor.
  // GPU raster through SwiftShader took 13 cores and missed 30fps on the busy scene; this takes 0.6 and doesn't.
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-gpu-compositing',
  '--disable-gpu-rasterization',
  '--disk-cache-size=268435456',
  ...screen.extraFlags,
  'about:blank',
];

/** Raw I420 on stdout. A blocked pipe doesn't stop ffmpeg, it queues seconds of old frames: whoever reads this must drain it (latestFrames). */
export const captureArgv = (
  screen: ScreenConfig,
  fps: number = screen.fps
): readonly string[] => [
  screen.ffmpeg,
  '-hide_banner',
  '-loglevel',
  'error',
  '-nostdin',
  '-fflags',
  'nobuffer',
  '-flags',
  'low_delay',
  '-probesize',
  '32',
  '-analyzeduration',
  '0',
  '-thread_queue_size',
  '1',
  '-f',
  'x11grab',
  '-framerate',
  String(fps),
  '-video_size',
  `${screen.width}x${screen.height}`,
  '-draw_mouse',
  '0',
  '-i',
  screen.display,
  '-an',
  '-fps_mode',
  'passthrough',
  '-pix_fmt',
  'yuv420p',
  '-f',
  'rawvideo',
  'pipe:1',
];

/** Cuts a byte stream into frames. The yielded buffer is reused: done with it before asking for the next. */
export async function* cutFrames(
  chunks: AsyncIterable<Uint8Array>,
  size: number
): AsyncGenerator<Uint8Array> {
  const frame = new Uint8Array(size);
  let filled = 0;
  for await (const chunk of chunks) {
    let at = 0;
    while (at < chunk.length) {
      const take = Math.min(size - filled, chunk.length - at);
      frame.set(chunk.subarray(at, at + take), filled);
      filled += take;
      at += take;
      if (filled === size) {
        filled = 0;
        yield frame;
      }
    }
  }
}

/**
 * Always drains the source and yields only the newest frame, dropping what a
 * slow reader missed, so falling behind costs frames rather than latency:
 * behind a reader taking 100 ms a frame, ffmpeg queued 2.6 s of old ones.
 * The yielded buffer is reused: done with it before asking for the next.
 */
export async function* latestFrames(
  source: AsyncIterable<Uint8Array>,
  size: number
): AsyncGenerator<Uint8Array> {
  const latest = new Uint8Array(size);
  const out = new Uint8Array(size);
  const state = { fresh: false, ended: false, wake: () => {} };
  const pump = (async () => {
    try {
      for await (const frame of source) {
        latest.set(frame);
        state.fresh = true;
        state.wake();
      }
    } finally {
      state.ended = true;
      state.wake();
    }
  })();
  while (true) {
    if (!state.fresh) {
      if (state.ended) break;
      await new Promise<void>((resolve) => {
        state.wake = resolve;
      });
      continue;
    }
    out.set(latest);
    state.fresh = false;
    yield out;
  }
  await pump;
}

/**
 * The display as frames, while someone reads. I420, the configured size, for
 * `new VideoFrame(frame, width, height, VideoBufferType.I420)`.
 */
export type Capture = {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly format: 'I420';
  readonly pid: number;
  /** Newest frame first; the buffer is reused. Don't read these on a call's thread: at 1080p30 it takes 15% of one. */
  readonly frames: () => AsyncGenerator<Uint8Array>;
  readonly stop: () => void;
  readonly exited: Promise<number>;
};

export type ServePorts = {
  readonly config: ScreenConfig;
  readonly disk: Pick<
    Disk,
    'read' | 'write' | 'exists' | 'remove' | 'makeDirectory'
  >;
  readonly clock: Pick<Clock, 'sleep'>;
  readonly alive: (pid: number) => boolean;
  /** Starts a program on the display, with the given variables added, its output going to ours. */
  readonly start: (
    argv: readonly string[],
    env: Readonly<Record<string, string>>
  ) => Started;
  /** Resolves when the service is told to stop. */
  readonly stopped: Promise<void>;
  readonly log: (entry: {
    readonly event: string;
    readonly [key: string]: unknown;
  }) => Promise<void>;
};

const socketChecks = 100;
const socketCheckEvery = 100;
const restartAfter = 2_000;
const exitWithin = 5_000;

/** A killed Xvfb leaves its lock behind and the next one refuses to start. A live one keeps it. */
export const clearStaleDisplay = async ({
  config,
  disk,
  alive,
}: Pick<ServePorts, 'config' | 'disk' | 'alive'>): Promise<void> => {
  const lock = await disk.read(config.lock);
  if (lock === undefined) return;
  const pid = Number(lock.trim());
  if (Number.isInteger(pid) && pid > 0 && alive(pid))
    throw new Error(`display ${config.display} is held by pid ${pid}`);
  await disk.remove(config.lock);
  await disk.remove(config.socket);
};

/** One life of the three: Xvfb and the sound server, then Chromium on both, until any dies or the service is stopped. Returns who died. */
const life = async (
  { config, disk, clock, start, stopped, log }: ServePorts,
  stopping: () => boolean
): Promise<string> => {
  const env = { FONTCONFIG_FILE: config.fontsFile };
  const xvfb = start(xvfbArgv(config), env);
  const pulse = start(pulseArgv(config), pulseEnv(config));
  const children = [xvfb, pulse];
  const end = async (): Promise<void> => {
    for (const child of children) child.kill();
    // Both gone before the next life: a live Xvfb still holds the display.
    await Promise.race([
      Promise.all(children.map((child) => child.exited)),
      clock.sleep(exitWithin),
    ]);
  };
  void stopped.then(end);
  // Xvfb refuses a display someone else holds, and says so only by exiting.
  const refused: { code?: number; sound?: number } = {};
  void xvfb.exited.then((code) => {
    refused.code = code;
  });
  void pulse.exited.then((code) => {
    refused.sound = code;
  });
  const ready = async (): Promise<boolean> =>
    (await disk.exists(config.socket)) &&
    (await disk.exists(config.sound.socket));
  try {
    for (
      let check = 0;
      check < socketChecks &&
      !stopping() &&
      refused.code === undefined &&
      refused.sound === undefined &&
      !(await ready());
      check++
    )
      await clock.sleep(socketCheckEvery);
    if (stopping()) return 'stopped';
    if (refused.code !== undefined)
      return `Xvfb exited ${refused.code} before opening ${config.display}`;
    if (refused.sound !== undefined)
      return `pulseaudio exited ${refused.sound} before opening its socket`;
    if (!(await disk.exists(config.socket)))
      return `Xvfb never opened ${config.socket}`;
    if (!(await disk.exists(config.sound.socket)))
      return `pulseaudio never opened ${config.sound.socket}`;
    const chromium = start(chromiumArgv(config), {
      ...env,
      PULSE_SERVER: soundServer(config),
    });
    children.push(chromium);
    await log({
      event: 'up',
      xvfb: xvfb.pid,
      pulseaudio: pulse.pid,
      chromium: chromium.pid,
    });
    return await Promise.race([
      xvfb.exited.then((code) => `Xvfb exited ${code}`),
      pulse.exited.then((code) => `pulseaudio exited ${code}`),
      chromium.exited.then((code) => `chromium exited ${code}`),
    ]);
  } finally {
    await end();
  }
};

/**
 * The service: Xvfb, the sound server and Chromium, all started again when any dies, until
 * it is told to stop. Returns how many times it started them.
 */
export const serve = async (ports: ServePorts): Promise<number> => {
  const { config, disk, clock, stopped, log } = ports;
  const state = { stopping: false };
  void stopped.then(() => {
    state.stopping = true;
  });
  let starts = 0;
  while (!state.stopping) {
    await clearStaleDisplay(ports);
    await disk.makeDirectory(config.profile);
    // A killed server leaves its socket behind, and it would read as up.
    await disk.remove(config.sound.socket);
    await disk.makeDirectory(config.sound.directory);
    await disk.write(
      config.fontsFile,
      fontsConf(config.systemFonts, config.fonts)
    );
    starts++;
    const died = await life(ports, () => state.stopping);
    if (state.stopping) break;
    await log({ event: 'died', why: died });
    await Promise.race([clock.sleep(restartAfter), stopped]);
  }
  await log({ event: 'stopped', starts });
  return starts;
};

export type Status = {
  readonly up: boolean;
  /** Where the browser is driven: CDP, loopback only. */
  readonly cdp: string;
  readonly display: string;
  readonly browser?: string;
  readonly pages?: number;
  readonly frames?: {
    readonly format: 'I420';
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly frameBytes: number;
  };
};

const Version = z.object({ Browser: z.string() });
const Targets = z.array(z.object({ type: z.string() }));
const versionPath = '/json/version';
const listPath = '/json/list';
const pageType = 'page';

/** Is it up, and how to reach it. `get` reads JSON from the browser's DevTools address. */
export const status = async ({
  config,
  get,
}: {
  readonly config: ScreenConfig;
  readonly get: (path: string) => Promise<unknown>;
}): Promise<Status> => {
  const where = { cdp: cdpAddress(config.cdpPort), display: config.display };
  try {
    const version = Version.parse(await get(versionPath));
    const targets = Targets.parse(await get(listPath));
    return {
      up: true,
      ...where,
      browser: version.Browser,
      pages: targets.filter(({ type }) => type === pageType).length,
      frames: {
        format: 'I420',
        width: config.width,
        height: config.height,
        fps: config.fps,
        frameBytes: frameBytes(config),
      },
    };
  } catch {
    return { up: false, ...where };
  }
};
