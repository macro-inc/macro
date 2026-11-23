/**
 * A call's flight recorder: one events file per call (every event, ms since
 * the join started) and one WAV per voice, aligned to the same clock. None of
 * it touches the disk on the call's thread: it goes to a
 * `CallDisk`, which is a worker thread with a bounded queue that drops work
 * before it ever waits.
 */
import { level, wavDataOffset, wavHeader } from './audio.ts';
import type { Emit } from './types.ts';

/**
 * The disk as a call sees it. Every method returns at once. A write that
 * blocks on a slow disk holds the one thread that also feeds the agent's
 * voice, and a caller hears it as silence, so nothing here may wait.
 */
export type CallDisk = {
  /** Opens a file (and makes its directory), returning the handle the other methods take. */
  readonly open: (path: string, flags: 'a' | 'w') => number;
  /** Queues a line for an append. False: dropped, the queue is full. */
  readonly line: (id: number, text: string) => boolean;
  /** Queues bytes for an offset, copying them. False: dropped, and that stretch of the file stays a hole. */
  readonly at: (id: number, position: number, bytes: Uint8Array) => boolean;
  /** Closes the file; with a header, writes it and sizes the file first, so a trailing hole is still in it. */
  readonly end: (
    id: number,
    tail?: { readonly header: Uint8Array; readonly size: number }
  ) => void;
  /** Blocks until the queue is empty, at most `ms`. Never for a call's thread while the call is live. */
  readonly flush: (ms: number) => boolean;
};

/** Bytes waiting before new work is dropped. 16 MB is a minute of three tracks; event lines are small and worth more. */
export const diskLimits = {
  recording: 16 * 1024 * 1024,
  lines: 4 * 1024 * 1024,
} as const;
export type DiskLimits = {
  readonly recording: number;
  readonly lines: number;
};

/** How long an exiting process waits for the queue. ZFS stalled 14 s under load, and the watcher kills a leaving join at 17 s. */
export const exitFlushMs = 15_000;

export type EventLog = {
  readonly emit: Emit;
  /** Milliseconds since the join started: the `t` of every event, and the clock the recordings line up on. */
  readonly now: () => number;
  readonly close: () => void;
  /** The disk the log writes to, for the recorders that share it. */
  readonly disk: CallDisk | undefined;
};

/**
 * One call's event log. Without a file it only echoes, which is how a replay
 * shows its events. A full queue drops lines, and says how many once it can.
 */
export const eventLog = ({
  file,
  disk,
  elapsed,
  echo,
}: {
  readonly file?: string;
  readonly disk?: CallDisk;
  /** Milliseconds since the join started. */
  readonly elapsed: () => number;
  /** Also given every line, e.g. to print it. */
  readonly echo?: (line: string) => void;
}): EventLog => {
  const now = () => Math.round(elapsed());
  let handle =
    file === undefined || disk === undefined ? undefined : disk.open(file, 'a');
  let lost = 0;
  const write = (id: number, out: CallDisk, line: string) => {
    if (!out.line(id, `${line}\n`)) lost++;
    else if (
      lost > 0 &&
      out.line(
        id,
        `${JSON.stringify({ t: now(), type: 'log.dropped', events: lost })}\n`
      )
    )
      lost = 0;
  };
  return {
    now,
    disk,
    emit: (type, data = {}) => {
      const line = JSON.stringify({ t: now(), type, ...data });
      if (handle !== undefined && disk !== undefined) write(handle, disk, line);
      echo?.(line);
    },
    close: () => {
      if (handle !== undefined) disk?.end(handle);
      handle = undefined;
    },
  };
};

export type TrackRecorder = {
  /** One frame of 16-bit mono PCM, placed where the call clock says it belongs. */
  readonly write: (frame: Int16Array) => void;
  readonly close: () => void;
  /** Samples so far, holes included. */
  readonly written: () => number;
};

/** A stretch without frames longer than this is logged as a gap. */
const gapSeconds = 0.2;
const levelEveryMs = 1000;

/**
 * The recording of one voice. Audio goes to explicit offsets: a dropped frame
 * or a gap is a hole in the file, which reads as silence, so the track stays
 * on the call clock. The header is refreshed every second, so a process that
 * dies leaves a readable WAV a second short, not one that claims to be empty.
 */
export const trackRecorder = ({
  path,
  rate,
  log,
  disk,
  who,
}: {
  readonly path: string;
  readonly rate: number;
  readonly log: Pick<EventLog, 'emit' | 'now'>;
  readonly disk: CallDisk;
  readonly who: string;
}): TrackRecorder => {
  const file = disk.open(path, 'w');
  disk.at(file, 0, wavHeader(rate, 0));
  // The file starts at the call clock, so every track lines up.
  let written = Math.floor((log.now() / 1000) * rate);
  let droppedMs = 0;
  let frames: Int16Array[] = [];
  let levelSince = log.now();

  const flushLevel = () => {
    if (droppedMs > 0) {
      log.emit('recording.dropped', { who, ms: Math.round(droppedMs) });
      droppedMs = 0;
    }
    if (frames.length === 0) return;
    const all = new Int16Array(
      frames.reduce((total, frame) => total + frame.length, 0)
    );
    let offset = 0;
    for (const frame of frames) {
      all.set(frame, offset);
      offset += frame.length;
    }
    log.emit('audio.level', { who, frames: frames.length, ...level(all) });
    disk.at(file, 0, wavHeader(rate, written * 2));
    frames = [];
    levelSince = log.now();
  };

  return {
    written: () => written,
    write: (frame) => {
      const due = Math.floor((log.now() / 1000) * rate) - frame.length;
      const gap = due - written;
      if (gap > rate * gapSeconds) {
        log.emit('audio.gap', { who, ms: Math.round((gap / rate) * 1000) });
        written += gap;
      }
      const bytes = new Uint8Array(
        frame.buffer,
        frame.byteOffset,
        frame.byteLength
      );
      if (!disk.at(file, wavDataOffset + written * 2, bytes))
        droppedMs += (frame.length / rate) * 1000;
      written += frame.length;
      frames.push(frame);
      if (log.now() - levelSince >= levelEveryMs) flushLevel();
    },
    close: () => {
      flushLevel();
      disk.end(file, {
        header: wavHeader(rate, written * 2),
        size: wavDataOffset + written * 2,
      });
    },
  };
};

export const loopEveryMs = 50;
export const loopLogMs = 100;

/**
 * Logs every time the call's thread was late, because that is audio not
 * moving: `loop.lag` is what the report shows, and past 500 ms a caller
 * hears it. Returns the stop.
 */
export const watchLoop = (emit: Emit, now: () => number): (() => void) => {
  emit('loop.watch', { everyMs: loopEveryMs, logMs: loopLogMs });
  let last = now();
  const timer = setInterval(() => {
    const at = now();
    const late = at - last - loopEveryMs;
    last = at;
    if (late >= loopLogMs) emit('loop.lag', { ms: Math.round(late) });
  }, loopEveryMs);
  timer.unref();
  return () => clearInterval(timer);
};
