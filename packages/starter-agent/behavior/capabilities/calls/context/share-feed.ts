/**
 * The frames of a share: JPEGs from the screencast go to a worker, which
 * decodes them with ffmpeg, and I420 frames come back for the track. A
 * worker, because the call's thread must never wait on this:
 * cutting and decoding 720p frames on it would be heard in the agent's voice.
 */
import { z } from 'zod';
import type { FrameFeed } from '../share.ts';
import { latestFrameQueue, shareSettings } from '../share.ts';

/** What the feed tells its worker. */
export const ToWorker = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('start'),
    ffmpeg: z.string(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
  }),
  z.object({ kind: z.literal('jpeg'), data: z.instanceof(ArrayBuffer) }),
  z.object({ kind: z.literal('stop') }),
]);
export type ToWorker = z.infer<typeof ToWorker>;

/** What the worker tells the feed. */
export const FromWorker = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('started'), pid: z.number() }),
  z.object({ kind: z.literal('frame'), data: z.instanceof(ArrayBuffer) }),
  z.object({ kind: z.literal('end') }),
  z.object({ kind: z.literal('error'), error: z.string() }),
]);
export type FromWorker = z.infer<typeof FromWorker>;

/** JPEGs on stdin, raw I420 of one size and rate on stdout. */
export const decoderArgv = ({
  ffmpeg,
  width,
  height,
  fps,
}: {
  readonly ffmpeg: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}): readonly string[] => [
  ffmpeg,
  '-hide_banner',
  '-loglevel',
  'error',
  '-nostdin',
  // Without these ffmpeg reads 5 s of input before its first frame, and the share starts 5 s late.
  '-fflags',
  'nobuffer',
  '-probesize',
  '32',
  '-analyzeduration',
  '0',
  '-f',
  'image2pipe',
  '-framerate',
  String(fps),
  '-c:v',
  'mjpeg',
  '-i',
  'pipe:0',
  '-vf',
  `fps=${fps},scale=${width}:${height}`,
  '-an',
  '-pix_fmt',
  'yuv420p',
  '-f',
  'rawvideo',
  'pipe:1',
];

/** The decoder, by the name the flake's shell has on PATH. The headless build is enough: nothing here reads a display. */
const ffmpeg = 'ffmpeg';
const worker = './share-frames.ts';
const endsWithin = 500;

export const workerFrames = (): FrameFeed => {
  const frames = new Worker(new URL(worker, import.meta.url));
  const { width, height, fps } = shareSettings;
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
  frames.addEventListener('message', ({ data }) => {
    const told = FromWorker.safeParse(data);
    if (!told.success) return;
    if (told.data.kind === 'started') state.pid = told.data.pid;
    else if (told.data.kind === 'frame')
      queue.push(new Uint8Array(told.data.data));
    else end();
  });
  frames.addEventListener('error', end);
  tell({ kind: 'start', ffmpeg, width, height, fps });
  return {
    jpeg: (data) => tell({ kind: 'jpeg', data }, [data]),
    stop: async () => {
      queue.stop();
      if (!state.ended) {
        tell({ kind: 'stop' });
        await Promise.race([
          new Promise<void>((resolve) => {
            state.onEnd = resolve;
          }),
          new Promise<void>((resolve) => setTimeout(resolve, endsWithin)),
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
