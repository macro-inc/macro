import { fireAndForget } from '@core/util/fireAndForget';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type Accessor, createEffect, on } from 'solid-js';
import { z } from 'zod';

const storage = createUserScopedStorage('folder-uploads:pending:v1');

/**
 * A folder sent longer ago than this is dropped without asking the server:
 * its outcome is no longer news, and the indicator would only surprise.
 */
export const PENDING_FOLDER_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const pendingFolderUploadsSchema = z.array(
  z.object({
    requestId: z.string(),
    name: z.string(),
    sentAt: z.number(),
  })
);

export type PendingFolderUpload = z.infer<
  typeof pendingFolderUploadsSchema
>[number];

function readAll(userId: string): PendingFolderUpload[] {
  const raw = storage.read(userId);
  if (raw === null) return [];
  try {
    const parsed = pendingFolderUploadsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function isCurrent(upload: PendingFolderUpload, now: number): boolean {
  return now - upload.sentAt <= PENDING_FOLDER_UPLOAD_MAX_AGE_MS;
}

// Every change re-reads storage, so tabs that send folders at the same time
// keep each other's records, and drops what has expired.
function change(
  userId: string,
  edit: (uploads: PendingFolderUpload[]) => PendingFolderUpload[]
) {
  const now = Date.now();
  const kept = edit(readAll(userId)).filter((upload) => isCurrent(upload, now));
  storage.write(userId, JSON.stringify(kept));
}

/** Folders this account sent from this browser whose outcome nobody saw. */
export function readPendingFolderUploads(
  userId: string,
  now = Date.now()
): PendingFolderUpload[] {
  return readAll(userId).filter((upload) => isCurrent(upload, now));
}

/** Remembers a sent folder until its outcome is shown. */
export function rememberPendingFolderUpload(
  userId: string,
  upload: PendingFolderUpload
) {
  change(userId, (uploads) => [
    ...uploads.filter((other) => other.requestId !== upload.requestId),
    upload,
  ]);
}

export function forgetPendingFolderUpload(userId: string, requestId: string) {
  change(userId, (uploads) =>
    uploads.filter((upload) => upload.requestId !== requestId)
  );
}

/**
 * Picks folders sent before this page loaded back up, after a reload or a
 * crash, or from a tab opened while one is processing: each shows in the
 * upload indicator as Processing until the server says how it ended. A tab
 * that was already open when the folder was sent does not pick it up.
 */
export function useResumeFolderUploads(userId: Accessor<string | undefined>) {
  createEffect(
    on(userId, (id) => {
      if (!id || readPendingFolderUploads(id).length === 0) return;
      fireAndForget(resumeFolderUploads(id), 'file-upload');
    })
  );
}

// Imported on use: upload.ts imports this module.
async function resumeFolderUploads(userId: string) {
  const { resumePendingFolderUploads } = await import('./upload');
  await Promise.all(resumePendingFolderUploads(userId));
}
