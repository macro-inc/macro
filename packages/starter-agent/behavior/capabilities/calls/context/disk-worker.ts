/** The thread behind disk.ts. Its writes can block as long as the disk likes; nobody waits. */
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { parentPort } from 'node:worker_threads';
import { type Job, jobsSlot, linesSlot, recordingSlot } from './disk.ts';

const descriptors = new Map<number, number>();
let state: Int32Array | undefined;
let complaints = 0;
const mostComplaints = 5;

const run = (job: Exclude<Job, { readonly op: 'init' }>): void => {
  if (job.op === 'open') {
    // Creating a file takes a ZFS transaction too, so opens and mkdirs happen here.
    mkdirSync(dirname(job.path), { recursive: true });
    descriptors.set(job.id, openSync(job.path, job.flags));
    return;
  }
  const descriptor = descriptors.get(job.id);
  // Its open failed, and that's been said.
  if (descriptor === undefined) return;
  if (job.op === 'line') writeSync(descriptor, job.text);
  else if (job.op === 'at')
    writeSync(descriptor, job.bytes, 0, job.bytes.length, job.position);
  else {
    if (job.header !== undefined && job.size !== undefined) {
      writeSync(descriptor, job.header, 0, job.header.length, 0);
      ftruncateSync(descriptor, job.size);
    }
    closeSync(descriptor);
    descriptors.delete(job.id);
  }
};

parentPort?.on('message', (job: Job) => {
  if (job.op === 'init') {
    state = job.state;
    return;
  }
  try {
    run(job);
  } catch (error) {
    if (complaints++ < mostComplaints)
      console.error(`disk ${job.op}: ${error}`);
  }
  if (state === undefined) return;
  if (job.op === 'line') Atomics.sub(state, linesSlot, job.text.length);
  if (job.op === 'at') Atomics.sub(state, recordingSlot, job.bytes.length);
  Atomics.sub(state, jobsSlot, 1);
  Atomics.notify(state, jobsSlot);
});
