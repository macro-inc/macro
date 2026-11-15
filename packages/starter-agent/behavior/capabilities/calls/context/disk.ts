/**
 * Writes that must never hold up the caller's thread: one worker thread does
 * the disk, and a bounded queue drops work before it ever waits. A write can
 * sit for seconds on a loaded disk, and a call's only JS thread also feeds
 * the agent's voice.
 */
import { Worker } from 'node:worker_threads';
import {
  type CallDisk,
  type DiskLimits,
  diskLimits,
  exitFlushMs,
} from '../events.ts';

/** The slots of the counters both threads share: bytes of recording and of lines waiting, and jobs waiting. */
export const recordingSlot = 0;
export const linesSlot = 1;
export const jobsSlot = 2;
const slots = 3;

export type Job =
  | { readonly op: 'init'; readonly state: Int32Array }
  | {
      readonly op: 'open';
      readonly id: number;
      readonly path: string;
      readonly flags: 'a' | 'w';
    }
  | { readonly op: 'line'; readonly id: number; readonly text: string }
  | {
      readonly op: 'at';
      readonly id: number;
      readonly position: number;
      readonly bytes: Uint8Array;
    }
  | {
      readonly op: 'end';
      readonly id: number;
      readonly header?: Uint8Array;
      readonly size?: number;
    };

export type DiskWorker = CallDisk & {
  /** Ends the thread, with whatever it hadn't written. */
  readonly stop: () => void;
};

const workerFile = './disk-worker.ts';

export const diskWorker = (limits: DiskLimits = diskLimits): DiskWorker => {
  // node:worker_threads's Worker, not the web one: sharp's WebAssembly build overwrites the global.
  const worker = new Worker(new URL(workerFile, import.meta.url));
  const state = new Int32Array(
    new SharedArrayBuffer(slots * Int32Array.BYTES_PER_ELEMENT)
  );
  let next = 1;
  let dead = false;
  // The thread never keeps the process alive: the exit flush is what waits for it.
  worker.unref();
  // Typed `unknown` by the newer @types/node the computer's image installs.
  worker.on('error', (error: unknown) => {
    dead = true;
    console.error(
      `disk worker died: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  const send = (job: Job, transfer: ArrayBuffer[] = []) => {
    if (dead) return;
    Atomics.add(state, jobsSlot, 1);
    worker.postMessage(job, transfer);
  };
  // Not through `send`: the counters aren't work to wait for.
  worker.postMessage({ op: 'init', state } satisfies Job);

  return {
    open: (path, flags) => {
      const id = next++;
      send({ op: 'open', id, path, flags });
      return id;
    },
    line: (id, text) => {
      if (dead || Atomics.load(state, linesSlot) + text.length > limits.lines)
        return false;
      Atomics.add(state, linesSlot, text.length);
      send({ op: 'line', id, text });
      return true;
    },
    at: (id, position, bytes) => {
      if (
        dead ||
        Atomics.load(state, recordingSlot) + bytes.length > limits.recording
      )
        return false;
      Atomics.add(state, recordingSlot, bytes.length);
      // A copy the worker owns: the caller's frame is reused.
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      send({ op: 'at', id, position, bytes: copy }, [copy.buffer]);
      return true;
    },
    end: (id, tail) => send({ op: 'end', id, ...tail }),
    flush: (ms) => {
      const until = performance.now() + ms;
      for (;;) {
        const jobs = Atomics.load(state, jobsSlot);
        if (jobs === 0) return true;
        const left = until - performance.now();
        if (left <= 0 || dead) return false;
        Atomics.wait(state, jobsSlot, jobs, left);
      }
    },
    stop: () => worker.terminate(),
  };
};

let shared: DiskWorker | undefined;

/**
 * The process's disk worker, started on first use. It finishes what it can
 * on the way out, however the process exits: 10 s lost a call's tail to a
 * 14 s stall, so the wait is 15 s.
 */
export const callDisk = (): CallDisk => {
  if (shared !== undefined) return shared;
  const worker = diskWorker();
  shared = worker;
  process.once('exit', () => worker.flush(exitFlushMs));
  return worker;
};
