const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export class DocumentRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 502 | 504
  ) {
    super(message);
    this.name = 'DocumentRequestError';
  }
}

export interface DocumentStorage {
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
    throw new DocumentRequestError(
      'The document snapshot is too large or invalid.',
      413
    );
  try {
    const decoded = atob(value);
    if (decoded.length > MAX_SNAPSHOT_BYTES)
      throw new Error('Snapshot limit exceeded');
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  } catch {
    throw new DocumentRequestError(
      'The sync service returned an invalid document snapshot.',
      502
    );
  }
}

async function responseJson(
  response: Response,
  operation: 'read' | 'edit'
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const status = response.status;
    // Surface actionable failures without leaking an upstream error body/token.
    if (status === 409)
      throw new DocumentRequestError(
        'The document changed since it was read. Read the affected ranges again and retry with the new revision.',
        409
      );
    if (status === 401 || status === 403)
      throw new DocumentRequestError(
        'You do not have the required access to this document.',
        status
      );
    if (status === 404)
      throw new DocumentRequestError('The document could not be found.', 404);
    if (status === 413 && operation === 'read')
      throw new DocumentRequestError(
        'This document exceeds the 4 MiB snapshot limit for AI tools. Reduce its size before using document tools.',
        413
      );
    if (status === 400 || status === 413)
      throw new DocumentRequestError(
        'The document update was rejected by the sync service. Read the document and use a smaller valid batch.',
        status
      );
    throw new DocumentRequestError(
      'The document sync service is unavailable. Please retry.',
      502
    );
  }
  // Bound the base64 envelope before JSON parsing or allocating decoded bytes.
  const maxBody = Math.ceil(MAX_SNAPSHOT_BYTES / 3) * 4 + 128 * 1024;
  const reader = response.body?.getReader();
  if (!reader)
    throw new DocumentRequestError(
      'The sync service returned an empty response.',
      502
    );
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
        throw new DocumentRequestError(
          'The document snapshot exceeds the supported size limit.',
          413
        );
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
    throw new DocumentRequestError(
      'The sync service returned an invalid JSON response.',
      502
    );
  }
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new DocumentRequestError(
      'The sync service returned an invalid response.',
      502
    );
  return result as Record<string, unknown>;
}

/** Sync validates the signed token's document ID and minimum permission per call. */
export function createDocumentStorage(
  syncBase: string,
  documentId: string,
  documentToken: string,
  fetcher: (
    ...args: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch> = fetch
): DocumentStorage {
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
        throw new DocumentRequestError(
          'The sync service did not return a revision.',
          502
        );
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
        throw new DocumentRequestError(
          'The sync service did not confirm the update. Read the document before retrying.',
          502
        );
      return { revision: data.revision, applied: data.applied };
    },
  };
}
