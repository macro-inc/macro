/**
 * The worker of a share's frame feed (`share-feed.ts`): ffmpeg captures the
 * desktop, and frames are cut here, off the call's thread.
 */
import { parentPort } from 'node:worker_threads';
import {
  captureArgv,
  captureEnv,
  cutFrames,
  desktop,
  frameBytes,
} from './desktop.ts';
import { type FromWorker, ToWorker } from './share-feed.ts';

const tell = (message: FromWorker, transfer: ArrayBuffer[] = []): void =>
  parentPort?.postMessage(message, transfer);

const state: { stopped: boolean; end?: () => void } = { stopped: false };

const capture = async (
  start: Extract<ToWorker, { kind: 'start' }>
): Promise<void> => {
  const child = Bun.spawn([...captureArgv(desktop(start.display), start)], {
    env: captureEnv(process.env),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  state.end = () => child.kill();
  tell({ kind: 'started', pid: child.pid });
  try {
    for await (const frame of cutFrames(child.stdout, frameBytes(start))) {
      if (state.stopped) break;
      const out = frame.slice().buffer;
      tell({ kind: 'frame', data: out }, [out]);
    }
  } catch (error) {
    tell({ kind: 'error', error: String(error) });
  } finally {
    tell({ kind: 'end' });
  }
};

parentPort?.on('message', (data: unknown) => {
  const told = ToWorker.safeParse(data);
  if (!told.success) return;
  if (told.data.kind === 'stop') {
    state.stopped = true;
    state.end?.();
    tell({ kind: 'end' });
  } else void capture(told.data);
});
