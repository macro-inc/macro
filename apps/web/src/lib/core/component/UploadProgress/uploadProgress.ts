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
};

type UploadProgressSummary = {
  label: string;
  /**
   * Share of all bytes sent, 0 to 1. Null while no upload is measurably
   * sending (hashing, server processing, native transports), where only an
   * indeterminate indicator is honest.
   */
  fraction: number | null;
};

export type UploadProgressHandle = {
  /** Report bytes sent so far, or null when the transport can't measure them. */
  sending: (sent: number | null) => void;
  /** All bytes are sent; the server is still preparing the file. */
  processing: () => void;
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
    { id, name, size, phase: 'preparing', sent: 0 },
  ]);
  return {
    sending: (sent) => update(id, { phase: 'sending', sent }),
    processing: () => update(id, { phase: 'processing' }),
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

function summarizeUploads(
  list: readonly TrackedUpload[]
): UploadProgressSummary | null {
  if (list.length === 0) return null;

  const label =
    list.length === 1
      ? `Uploading ${list[0].name}`
      : `Uploading ${list.length} files`;

  const measurable = list.some(
    (upload) => upload.phase === 'sending' && upload.sent !== null
  );
  const total = list.reduce((sum, upload) => sum + upload.size, 0);
  if (!measurable || total <= 0) return { label, fraction: null };

  const sent = list.reduce((sum, upload) => sum + sentBytes(upload), 0);
  return { label, fraction: Math.min(1, sent / total) };
}

export const uploadProgress = () => summarizeUploads(uploads());
