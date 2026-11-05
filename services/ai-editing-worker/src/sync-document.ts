/**
 * Sync-service's document state and revision-checked update routes. A commit
 * names the revision its update was built on; sync-service applies it only if
 * the document is still at that revision, so a writer never overwrites an edit
 * it did not see.
 */

export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/** Why a sync-service call failed, as each caller words it for its own users. */
export type SyncDocumentFailure =
  | 'conflict'
  | 'denied'
  | 'not_found'
  | 'too_large'
  | 'rejected'
  | 'unavailable'
  | 'invalid_response';

export type SyncDocumentOperation = 'read' | 'edit';

/** Never carries sync-service's response body, which may hold document content. */
export class SyncDocumentError extends Error {
  constructor(
    readonly failure: SyncDocumentFailure,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 502,
    readonly operation: SyncDocumentOperation
  ) {
    super(`sync service ${operation} failed: ${failure} (HTTP ${status})`);
    this.name = 'SyncDocumentError';
  }
}

export interface SyncDocumentStorage {
  load(
    signal: AbortSignal
  ): Promise<{ snapshot: Uint8Array; revision: string }>;
  commit(
    expectedRevision: string,
    update: Uint8Array,
    signal: AbortSignal
  ): Promise<{ revision: string; applied: boolean }>;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16_384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  return btoa(binary);
}

function decode(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(MAX_SNAPSHOT_BYTES / 3) * 4
  )
    throw new SyncDocumentError('too_large', 413, 'read');
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    throw new SyncDocumentError('invalid_response', 502, 'read');
  }
  if (decoded.length > MAX_SNAPSHOT_BYTES)
    throw new SyncDocumentError('too_large', 413, 'read');
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function failure(
  status: number,
  operation: SyncDocumentOperation
): SyncDocumentError {
  if (status === 409) return new SyncDocumentError('conflict', 409, operation);
  if (status === 401 || status === 403)
    return new SyncDocumentError('denied', status, operation);
  if (status === 404) return new SyncDocumentError('not_found', 404, operation);
  if (status === 413) return new SyncDocumentError('too_large', 413, operation);
  if (status === 400) return new SyncDocumentError('rejected', 400, operation);
  return new SyncDocumentError('unavailable', 502, operation);
}

async function responseJson(
  response: Response,
  operation: SyncDocumentOperation
): Promise<Record<string, unknown>> {
  if (!response.ok) throw failure(response.status, operation);
  // Bound the base64 envelope before JSON parsing or allocating decoded bytes.
  const maxBody = Math.ceil(MAX_SNAPSHOT_BYTES / 3) * 4 + 128 * 1024;
  const reader = response.body?.getReader();
  if (!reader) throw new SyncDocumentError('invalid_response', 502, operation);
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBody) {
        await reader.cancel();
        throw new SyncDocumentError('too_large', 413, operation);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new SyncDocumentError('invalid_response', 502, operation);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new SyncDocumentError('invalid_response', 502, operation);
  return result as Record<string, unknown>;
}

/** Sync validates the signed token's document ID and minimum permission per call. */
export function createSyncDocumentStorage(
  syncBase: string,
  documentId: string,
  documentToken: string,
  fetcher: (
    ...args: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch> = fetch
): SyncDocumentStorage {
  const base = new URL(syncBase);
  if (base.protocol === 'wss:') base.protocol = 'https:';
  else if (base.protocol === 'ws:') base.protocol = 'http:';
  if (base.protocol !== 'http:' && base.protocol !== 'https:')
    throw new Error('Invalid sync service URL.');
  const endpoint = `${base.toString().replace(/\/$/, '')}/document/${encodeURIComponent(documentId)}`;
  const headers = { Authorization: `Bearer ${documentToken}` };
  return {
    async load(signal) {
      const data = await responseJson(
        await fetcher(`${endpoint}/state`, { headers, signal }),
        'read'
      );
      if (typeof data.revision !== 'string' || !data.revision)
        throw new SyncDocumentError('invalid_response', 502, 'read');
      return { snapshot: decode(data.snapshot), revision: data.revision };
    },
    async commit(expectedRevision, update, signal) {
      const data = await responseJson(
        await fetcher(`${endpoint}/update`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision, update: encode(update) }),
          signal,
        }),
        'edit'
      );
      if (
        typeof data.revision !== 'string' ||
        typeof data.applied !== 'boolean'
      )
        throw new SyncDocumentError('invalid_response', 502, 'edit');
      return { revision: data.revision, applied: data.applied };
    },
  };
}
