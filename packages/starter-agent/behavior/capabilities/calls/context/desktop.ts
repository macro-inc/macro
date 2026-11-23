/**
 * The agent's desktop, as a share sees it: its display and its sound, and
 * the programs that read them, by the names the image has on PATH. Pure.
 */
import { childEnvironment } from '../../../context/children.ts';

export type Desktop = {
  /** The X display: DISPLAY, the one the agent's browser and computer use are on. */
  readonly display: string;
  /** Its size: Xvnc's. */
  readonly width: number;
  readonly height: number;
  /** An ffmpeg with x11grab: `ffmpeg` and `ffmpeg-headless` are built without it. */
  readonly ffmpeg: string;
  readonly parec: string;
  /** What the sound server's default sink plays, which the browser plays into. */
  readonly monitor: string;
  readonly rate: number;
  readonly channels: number;
};

export const desktop = (display: string): Desktop => ({
  display,
  width: 1920,
  height: 1080,
  ffmpeg: 'ffmpeg-x11grab',
  parec: 'parec',
  monitor: '@DEFAULT_MONITOR@',
  rate: 48_000,
  channels: 2,
});

/** I420: a full luma plane, then two quarter-size chroma planes. */
export const frameBytes = ({
  width,
  height,
}: {
  readonly width: number;
  readonly height: number;
}): number => (width * height * 3) / 2;

/**
 * The display as raw I420 at `width`x`height` and `fps`. No probing, no
 * queue: the first frame comes at once, and a slow reader loses frames,
 * never time.
 */
export const captureArgv = (
  screen: Desktop,
  out: { readonly width: number; readonly height: number; readonly fps: number }
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
  String(out.fps),
  '-video_size',
  `${screen.width}x${screen.height}`,
  '-i',
  screen.display,
  '-an',
  '-vf',
  `scale=${out.width}:${out.height}`,
  '-pix_fmt',
  'yuv420p',
  '-f',
  'rawvideo',
  'pipe:1',
];

/** The desktop's sound, as s16le PCM. */
export const recordArgv = (
  screen: Desktop,
  latencyMs: number
): readonly string[] => [
  screen.parec,
  `--device=${screen.monitor}`,
  '--raw',
  '--format=s16le',
  `--rate=${screen.rate}`,
  `--channels=${screen.channels}`,
  `--latency-msec=${latencyMs}`,
];

/**
 * A capture's environment: the child baseline (DISPLAY, PULSE_SERVER) and
 * nothing else of the call's, whose LiveKit library path kills a nix ffmpeg.
 */
export const captureEnv = (
  own: Readonly<Record<string, string | undefined>>
): Record<string, string> => childEnvironment(own);

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
