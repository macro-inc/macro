import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';

type UploadPhase = 'preparing' | 'sending' | 'processing';

type TrackedUpload = {
  id: number;
  name: string;
  size: number;
  phase: UploadPhase;
  /** Bytes sent while `sending`; null when the transport can't report bytes. */
  sent: number | null;
  /**
   * Share of the current preparing or processing work done, 0 to 1; null
   * when that step can't measure it.
   */
  done: number | null;
};

type UploadProgressSummary = {
  label: string;
  /**
   * Share of the work done, 0 to 1. Null while nothing measurable is running
   * (hashing, server processing without reports, native transports), where
   * only an indeterminate indicator is honest.
   */
  fraction: number | null;
};

export type UploadProgressHandle = {
  /**
   * The files are being read before anything is sent; `fraction` is how much
   * of them, or null when that can't be measured.
   */
  preparing: (fraction: number | null) => void;
  /** Report bytes sent so far, or null when the transport can't measure them. */
  sending: (sent: number | null) => void;
  /**
   * All bytes are sent; the server is still preparing the file. `fraction` is
   * how much of that the server reports done, or null when it doesn't.
   */
  processing: (fraction?: number | null) => void;
  /** Stop tracking, whether the upload succeeded or failed. */
  done: () => void;
};

const [uploads, setUploads] = createSignal<readonly TrackedUpload[]>([]);
let nextId = 0;

function update(id: number, patch: Partial<TrackedUpload>) {
  setUploads((list) =>
    list.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload))
  );
}

/** Show an upload in the global upload progress indicator until `done`. */
export function trackUpload(name: string, size: number): UploadProgressHandle {
  const id = ++nextId;
  setUploads((list) => [
    ...list,
    { id, name, size, phase: 'preparing', sent: 0, done: null },
  ]);
  return {
    preparing: (fraction) => update(id, { phase: 'preparing', done: fraction }),
    sending: (sent) => update(id, { phase: 'sending', sent }),
    processing: (fraction = null) =>
      update(id, { phase: 'processing', done: fraction }),
    done: () => setUploads((list) => list.filter((upload) => upload.id !== id)),
  };
}

function sentBytes(upload: TrackedUpload): number {
  return match(upload.phase)
    .with('preparing', () => 0)
    .with('sending', () => Math.min(upload.sent ?? 0, upload.size))
    .with('processing', () => upload.size)
    .exhaustive();
}

function phaseVerb(phase: UploadPhase): string {
  return match(phase)
    .with('preparing', () => 'Preparing')
    .with('sending', () => 'Uploading')
    .with('processing', () => 'Processing')
    .exhaustive();
}

function summarizeUpload(upload: TrackedUpload): UploadProgressSummary {
  const fraction = match(upload.phase)
    .with('preparing', 'processing', () => upload.done)
    .with('sending', () =>
      upload.sent === null || upload.size <= 0
        ? null
        : Math.min(1, upload.sent / upload.size)
    )
    .exhaustive();
  return { label: `${phaseVerb(upload.phase)} ${upload.name}`, fraction };
}

function summarizeUploads(
  list: readonly TrackedUpload[]
): UploadProgressSummary | null {
  if (list.length === 0) return null;
  if (list.length === 1) return summarizeUpload(list[0]);

  // Several uploads at the same stage name it; mixed stages read as uploading.
  const phases = new Set(list.map((upload) => upload.phase));
  const verb = phases.size === 1 ? phaseVerb(list[0].phase) : 'Uploading';
  const label = `${verb} ${list.length} files`;
  const measurable = list.some(
    (upload) => upload.phase === 'sending' && upload.sent !== null
  );
  const total = list.reduce((sum, upload) => sum + upload.size, 0);
  if (!measurable || total <= 0) return { label, fraction: null };

  const sent = list.reduce((sum, upload) => sum + sentBytes(upload), 0);
  return { label, fraction: Math.min(1, sent / total) };
}

export const uploadProgress = () => summarizeUploads(uploads());
