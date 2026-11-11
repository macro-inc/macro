/**
 * The frames of a share: a worker captures the desktop with ffmpeg and cuts
 * I420 frames for the track. A worker, because the call's thread must never
 * wait on this: reading 720p frames on it would be heard in the agent's voice.
 */
import { z } from 'zod';
import type { FrameFeed } from '../share.ts';
import { latestFrameQueue, shareSettings } from '../share.ts';

/** What the feed tells its worker. */
export const ToWorker = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('start'),
    display: z.string(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
  }),
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

const worker = './share-frames.ts';
const endsWithin = 500;

/** Captures `display` until stopped. */
export const workerFrames = (display: string): FrameFeed => {
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
  const tell = (message: ToWorker): void => frames.postMessage(message);
  frames.addEventListener('message', ({ data }) => {
    const told = FromWorker.safeParse(data);
    if (!told.success) return;
    if (told.data.kind === 'started') state.pid = told.data.pid;
    else if (told.data.kind === 'frame')
      queue.push(new Uint8Array(told.data.data));
    else end();
  });
  frames.addEventListener('error', end);
  tell({ kind: 'start', display, width, height, fps });
  return {
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
