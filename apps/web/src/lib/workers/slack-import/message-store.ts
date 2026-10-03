import { z } from 'zod';
import { ArchiveError } from '../../../features/slack-import/core/export';

export const MAX_RECORD_BYTES = 1024 * 1024;
const PAGE_BYTES = 1024 * 1024;
const PAGE_RECORDS = 128;
const encoder = new TextEncoder();
const optionalText = z.string().nullish();
const userId = z.string().regex(/^[UW][A-Z0-9]{1,63}$/);
const timestamp = z.string().transform((value) => exactTimestamp(value));
const messageSchema = z.object({
  ts: timestamp,
  thread_ts: timestamp.nullish(),
  subtype: optionalText,
  text: z.string().default(''),
  user: userId.nullish(),
  user_profile: z
    .object({
      email: optionalText,
      display_name: optionalText,
      real_name: optionalText,
    })
    .nullish(),
  username: optionalText,
  bot_profile: z.object({ name: optionalText }).nullish(),
  reactions: z
    .array(
      z.object({
        name: z.string(),
        users: z.array(userId).default([]),
        ts: timestamp.nullish(),
      })
    )
    .default([]),
});

/** Canonical decimal timestamps match Rust's SlackTimestamp without floating point. */
export function exactTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new ArchiveError('invalid_message');
  const match = /^(\d{1,12})\.(\d{1,6})$/.exec(value);
  if (!match || BigInt(match[1]) > 253402300799n)
    throw new ArchiveError('invalid_message');
  return `${BigInt(match[1])}.${match[2].padEnd(6, '0')}`;
}

/** Pad seconds to twelve digits so IndexedDB string ordering is chronological. */
function sortKey(value: string): string {
  return value.padStart(19, '0');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ArchiveError('invalid_message');
  return value as Record<string, unknown>;
}

export type StoredMessage = {
  conversation: string;
  time: string;
  revision: string;
  line: string;
  byteLength: number;
};

/** Whitelist the Rust ExportRecord fields; attachments, blocks and replies never reach disk.
 * Edits use the inner identity. Missing edited.ts on wrappers falls back to event time.
 * Equal revisions choose the lexicographically greatest normalized line (not arrival order).
 */
export function normalizeMessage(
  conversation: string,
  record: Record<string, unknown>
): StoredMessage | undefined {
  if (record.type != null && record.type !== 'message') return;
  const changed = record.subtype === 'message_changed';
  const source = changed ? object(record.message) : record;
  if (source.subtype === 'message_deleted' || source.subtype === 'tombstone')
    return;
  const parsed = messageSchema.safeParse(source);
  if (!parsed.success) throw new ArchiveError('invalid_message');
  const message = parsed.data;
  let revision = message.ts;
  if (source.edited != null)
    revision = exactTimestamp(object(source.edited).ts);
  else if (changed)
    revision = exactTimestamp(record.event_ts ?? record.ts ?? message.ts);
  const line = `${JSON.stringify({ type: 'message', ...message })}\n`;
  const byteLength = encoder.encode(line).length;
  if (byteLength > MAX_RECORD_BYTES) throw new ArchiveError('record_limit');
  return {
    conversation,
    time: sortKey(message.ts),
    revision: sortKey(revision),
    line,
    byteLength,
  };
}

function storageError(error: unknown): ArchiveError {
  if (error instanceof ArchiveError) return error;
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return new ArchiveError('storage_quota');
  return new ArchiveError('storage_unavailable');
}

function databaseName(sessionId: string): string {
  return `slack-import-scratch:${sessionId}`;
}

/** Also call after Worker.terminate(): a terminated worker cannot execute finally. */
export async function deleteMessageStore(sessionId: string): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName(sessionId));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new ArchiveError('storage_unavailable'));
    });
  } catch (error) {
    throw storageError(error);
  }
}

/** One writer per session. Transactions and cursor pages are byte- and count-bounded. */
export class MessageStore {
  private totalBytes = 0;

  private constructor(
    private readonly db: IDBDatabase,
    private readonly sessionId: string,
    private readonly maxBytes: number
  ) {}

  static async open(
    sessionId: string,
    maxBytes: number
  ): Promise<MessageStore> {
    // Reusing a caller's session after termination must never reuse partial history.
    await deleteMessageStore(sessionId);
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName(sessionId), 1);
        request.onupgradeneeded = () => {
          const messages = request.result.createObjectStore('messages', {
            keyPath: ['conversation', 'time'],
          });
          messages.createIndex('conversation', 'conversation');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.onversionchange = () => db.close();
      return new MessageStore(db, sessionId, maxBytes);
    } catch (error) {
      throw storageError(error);
    }
  }

  async stage(
    conversation: string,
    records: readonly Record<string, unknown>[],
    signal?: AbortSignal
  ): Promise<void> {
    let batch: StoredMessage[] = [];
    let bytes = 0;
    for (const record of records) {
      if (signal?.aborted) throw new ArchiveError('cancelled');
      const message = normalizeMessage(conversation, record);
      if (!message) continue;
      if (
        batch.length &&
        (batch.length >= PAGE_RECORDS ||
          bytes + message.byteLength > PAGE_BYTES)
      ) {
        await this.writeBatch(batch, signal);
        batch = [];
        bytes = 0;
      }
      batch.push(message);
      bytes += message.byteLength;
    }
    if (batch.length) await this.writeBatch(batch, signal);
  }

  private async writeBatch(
    batch: StoredMessage[],
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) throw new ArchiveError('cancelled');
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        let bytes = this.totalBytes;
        let failure: ArchiveError | undefined;
        function abort(): void {
          tx.abort();
        }
        signal?.addEventListener('abort', abort, { once: true });
        tx.oncomplete = () => {
          signal?.removeEventListener('abort', abort);
          this.totalBytes = bytes;
          resolve();
        };
        tx.onabort = () => {
          signal?.removeEventListener('abort', abort);
          reject(
            signal?.aborted
              ? new ArchiveError('cancelled')
              : (failure ?? tx.error)
          );
        };
        // Queue each lookup after the previous write, including duplicates in this batch.
        let index = 0;
        const next = (): void => {
          const message = batch[index++];
          if (!message) return;
          const request = store.get([message.conversation, message.time]);
          request.onsuccess = () => {
            const existing: StoredMessage | undefined = request.result;
            if (
              existing &&
              (existing.revision > message.revision ||
                (existing.revision === message.revision &&
                  existing.line >= message.line))
            ) {
              next();
              return;
            }
            bytes += message.byteLength - (existing?.byteLength ?? 0);
            if (bytes > this.maxBytes) {
              failure = new ArchiveError('selected_limit');
              tx.abort();
              return;
            }
            try {
              store.put(message).onsuccess = next;
            } catch (error) {
              failure = storageError(error);
              tx.abort();
            }
          };
        };
        next();
      });
    } catch (error) {
      throw storageError(error);
    }
  }

  private async page(
    conversation: string,
    after?: string
  ): Promise<StoredMessage[]> {
    try {
      return await new Promise<StoredMessage[]>((resolve, reject) => {
        const tx = this.db.transaction('messages', 'readonly');
        const range = IDBKeyRange.bound(
          [conversation, after ?? ''],
          [conversation, '\uffff'],
          after !== undefined
        );
        const request = tx.objectStore('messages').openCursor(range);
        const page: StoredMessage[] = [];
        let bytes = 0;
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const message: StoredMessage = cursor.value;
          if (
            page.length &&
            (page.length >= PAGE_RECORDS ||
              bytes + message.byteLength > PAGE_BYTES)
          )
            return;
          page.push(message);
          bytes += message.byteLength;
          cursor.continue();
        };
        tx.oncomplete = () => resolve(page);
        tx.onabort = () => reject(tx.error);
      });
    } catch (error) {
      throw storageError(error);
    }
  }

  async *ordered(
    conversation: string,
    signal?: AbortSignal
  ): AsyncGenerator<StoredMessage> {
    let after: string | undefined;
    while (true) {
      if (signal?.aborted) throw new ArchiveError('cancelled');
      const page = await this.page(conversation, after);
      if (!page.length) return;
      for (const message of page) {
        if (signal?.aborted) throw new ArchiveError('cancelled');
        yield message;
      }
      after = page[page.length - 1].time;
    }
  }

  async dispose(): Promise<void> {
    this.db.close();
    await deleteMessageStore(this.sessionId);
  }
}
