import { fireAndForget } from '@core/util/fireAndForget';
import {
  createUserScopedStorage,
  userScopedStorageKey,
} from '@core/util/userScopedStorage';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { z } from 'zod';

const STORAGE_KEY = 'folder-uploads:pending:v1';
const storage = createUserScopedStorage(STORAGE_KEY);

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
 * Shows the account's folders that another page sent: those sent before this
 * page loaded, after a reload or a crash, and those another open tab sends
 * later. Each shows in the upload indicator as Processing until the server
 * says how it ended.
 */
export function useResumeFolderUploads(userId: Accessor<string | undefined>) {
  createEffect(
    on(userId, (id) => {
      if (!id) return;
      const followPending = () => {
        if (readPendingFolderUploads(id).length === 0) return;
        fireAndForget(resumeFolderUploads(id), 'file-upload');
      };
      // Fired by another tab's write; a null key means it cleared storage.
      const onStorage = (event: StorageEvent) => {
        if (
          event.key === null ||
          event.key === userScopedStorageKey(STORAGE_KEY, id)
        )
          followPending();
      };
      window.addEventListener('storage', onStorage);
      onCleanup(() => window.removeEventListener('storage', onStorage));
      followPending();
    })
  );
}

// Imported on use: upload.ts imports this module.
async function resumeFolderUploads(userId: string) {
  const { resumePendingFolderUploads } = await import('./upload');
  await Promise.all(resumePendingFolderUploads(userId));
}
