import type {
  DraftAttempt,
  LocalDraft,
} from '@app/features/email-compose/core/local-draft';

/** Only pre-metadata queue entries need a separate durable association. */
type AttemptRecord = DraftAttempt & {
  transactionId: string;
  storageGeneration: string;
};
type Session = { accountId: string; epoch: string };
type StoredDraft = LocalDraft & { epoch: string };
const STORES = ['drafts', 'files', 'attempts', 'meta'] as const;

/** Transactional working-copy storage. Unlike a query cache, it never evicts edits. */
export function createLocalDraftStore(
  dbName = 'macro-email-working-copies-v1'
) {
  let connection: Promise<IDBDatabase> | undefined;
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | undefined;
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error('Unable to notify local draft subscriber', error);
      }
    }
  };
  const changed = () => {
    notify();
    try {
      channel?.postMessage(null);
    } catch {
      /* Durable state remains readable without notifications. */
    }
  };
  const open = () =>
    (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        for (const name of STORES) request.result.createObjectStore(name);
      };
      request.onerror = () => {
        connection = undefined;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
        try {
          if (typeof BroadcastChannel !== 'undefined' && !channel) {
            channel = new BroadcastChannel(dbName);
            channel.onmessage = notify;
          }
        } catch {
          /* Embedded browsers may expose an unavailable channel. */
        }
      };
    }));
  async function transaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction, finish: (value: T) => void) => void,
    publish = true
  ): Promise<T> {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([...STORES], mode);
      let value: T;
      tx.oncomplete = () => {
        resolve(value);
        if (mode === 'readwrite' && publish) changed();
      };
      tx.onabort = () =>
        reject(tx.error ?? new Error('Draft storage transaction aborted'));
      tx.onerror = () =>
        reject(tx.error ?? new Error('Unable to save draft on this device'));
      try {
        run(tx, (next) => {
          value = next;
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }
  function withSession<T>(
    tx: IDBTransaction,
    session: Session,
    run: () => void,
    finish: (value: T) => void,
    stale: T
  ) {
    const request = tx.objectStore('meta').get('session');
    request.onsuccess = () => {
      const current = request.result as Session | undefined;
      if (
        current?.accountId !== session.accountId ||
        current.epoch !== session.epoch
      ) {
        finish(stale);
        return;
      }
      run();
    };
  }
  const read = async (session: Session, id: string) =>
    await transaction<LocalDraft | undefined>('readonly', (tx, finish) => {
      withSession(
        tx,
        session,
        () => {
          const request = tx.objectStore('drafts').getAll();
          request.onsuccess = () =>
            finish(
              (request.result as StoredDraft[]).find(
                (draft) =>
                  draft.epoch === session.epoch &&
                  draft.accountId === session.accountId &&
                  (draft.key === id ||
                    draft.draftId === id ||
                    draft.serverDraftId === id)
              )
            );
        },
        finish,
        undefined
      );
    });
  return {
    /** Account transitions clear old content and fence outstanding transactions. */
    async activate(
      accountId: string,
      epoch?: string,
      isCurrent = () => true
    ): Promise<Session> {
      return await transaction(
        'readwrite',
        (tx, finish) => {
          const meta = tx.objectStore('meta');
          const retired = meta.get(['retired-session', epoch ?? '']);
          retired.onsuccess = () => {
            if (epoch && retired.result) {
              tx.abort();
              return;
            }
            const request = meta.get('session');
            request.onsuccess = () => {
              const previous = request.result as Session | undefined;
              if (
                !isCurrent() ||
                (previous &&
                  previous.accountId !== accountId &&
                  (!epoch || previous.epoch === epoch))
              ) {
                tx.abort();
                return;
              }
              if (
                previous?.accountId === accountId &&
                (!epoch || previous.epoch === epoch)
              ) {
                finish(previous);
                return;
              }
              for (const name of STORES) tx.objectStore(name).clear();
              const session = {
                accountId,
                epoch: epoch ?? crypto.randomUUID(),
              };
              meta.put(session, 'session');
              finish(session);
            };
          };
        },
        false
      );
    },
    read,
    async generation(
      session: Session,
      key: string,
      revive = false
    ): Promise<string> {
      const result = await transaction<string | undefined>(
        'readwrite',
        (tx, finish) =>
          withSession(
            tx,
            session,
            () => {
              const meta = tx.objectStore('meta');
              const request = meta.get(['generation', key]);
              request.onsuccess = () => {
                const generation = revive
                  ? crypto.randomUUID()
                  : (request.result ?? crypto.randomUUID());
                meta.put(generation, ['generation', key]);
                finish(generation);
              };
            },
            finish,
            undefined
          ),
        false
      );
      if (!result) throw new Error('This draft session is no longer active');
      return result;
    },
    async list(session: Session): Promise<LocalDraft[]> {
      return await transaction('readonly', (tx, finish) =>
        withSession(
          tx,
          session,
          () => {
            const request = tx.objectStore('drafts').getAll();
            request.onsuccess = () =>
              finish(
                (request.result as StoredDraft[]).filter(
                  (draft) =>
                    draft.accountId === session.accountId &&
                    draft.epoch === session.epoch
                )
              );
          },
          finish,
          []
        )
      );
    },
    /** Compare the snapshot revision and commit its content and files atomically. */
    async save(
      session: Session,
      input: Omit<
        LocalDraft,
        'revision' | 'acknowledgedRevision' | 'updatedAt'
      > & { expectedRevision: number },
      files: ReadonlyMap<string, Blob> = new Map()
    ): Promise<LocalDraft> {
      const result = await transaction<LocalDraft | Error | undefined>(
        'readwrite',
        (tx, finish) =>
          withSession(
            tx,
            session,
            () => {
              const drafts = tx.objectStore('drafts');
              const retired = tx
                .objectStore('meta')
                .get(['retired', input.key, input.generation]);
              retired.onsuccess = () => {
                if (retired.result) {
                  finish(undefined);
                  return;
                }
                const request = drafts.get(input.key);
                request.onsuccess = () => {
                  const previous = request.result as StoredDraft | undefined;
                  if (previous && previous.generation !== input.generation) {
                    finish(undefined);
                    return;
                  }
                  const paused =
                    previous?.status === 'failed' ||
                    previous?.status === 'unconfirmed' ||
                    previous?.status === 'delete-failed';
                  if (previous?.status === 'deleting') {
                    finish(undefined);
                    return;
                  }
                  if ((previous?.revision ?? 0) !== input.expectedRevision) {
                    finish(
                      new Error(
                        'This draft changed while saving. Reopen it to use the latest version.'
                      )
                    );
                    return;
                  }
                  const { expectedRevision: _expectedRevision, ...snapshot } =
                    input;
                  const draft: StoredDraft = {
                    ...snapshot,
                    epoch: session.epoch,
                    latestAttemptId: previous?.latestAttemptId,
                    queuedAttemptId: previous?.queuedAttemptId,
                    attachments: input.attachments.map((attachment) => {
                      if (attachment.type !== 'local') return attachment;
                      const receipt = previous?.attachments.find(
                        (saved) =>
                          saved.type === 'local' && saved.id === attachment.id
                      );
                      // Upload callbacks can commit while file bytes are being copied.
                      // The working-copy snapshot must not erase a newer receipt.
                      return receipt?.type === 'local'
                        ? {
                            ...attachment,
                            attachmentId:
                              receipt.attachmentId ??
                              (attachment.uploaded
                                ? attachment.attachmentId
                                : undefined),
                            uploaded:
                              receipt.uploaded ||
                              (attachment.uploaded &&
                                (!receipt.attachmentId ||
                                  receipt.attachmentId ===
                                    attachment.attachmentId)),
                          }
                        : attachment;
                    }),
                    serverDraftId:
                      previous?.serverDraftId ?? input.serverDraftId,
                    serverThreadId:
                      previous?.serverThreadId ?? input.serverThreadId,
                    revision: (previous?.revision ?? 0) + 1,
                    acknowledgedRevision: previous?.acknowledgedRevision ?? 0,
                    status: paused ? previous.status : 'dirty',
                    errorCode: paused ? previous.errorCode : undefined,
                    updatedAt: Date.now(),
                  };
                  for (const [id, blob] of files)
                    tx.objectStore('files').put(blob, [input.key, id]);
                  const retained = new Set(
                    input.attachments.flatMap((a) =>
                      a.type === 'local' ? [a.id] : []
                    )
                  );
                  for (const attachment of previous?.attachments ?? [])
                    if (
                      attachment.type === 'local' &&
                      !retained.has(attachment.id)
                    )
                      tx.objectStore('files').delete([
                        input.key,
                        attachment.id,
                      ]);
                  drafts.put(draft, input.key);
                  finish(draft);
                };
              };
            },
            finish,
            undefined
          )
      );
      if (result instanceof Error) throw result;
      if (!result) throw new Error('This draft session is no longer active');
      return result;
    },
    async file(
      session: Session,
      key: string,
      id: string
    ): Promise<Blob | undefined> {
      return await transaction('readonly', (tx, finish) =>
        withSession(
          tx,
          session,
          () => {
            const request = tx.objectStore('files').get([key, id]);
            request.onsuccess = () => finish(request.result);
          },
          finish,
          undefined
        )
      );
    },
    async update(
      session: Session,
      key: string,
      change: (draft: LocalDraft) => LocalDraft | undefined
    ): Promise<LocalDraft | undefined> {
      return await transaction('readwrite', (tx, finish) =>
        withSession(
          tx,
          session,
          () => {
            const drafts = tx.objectStore('drafts');
            const request = drafts.get(key);
            request.onsuccess = () => {
              const previous = request.result as StoredDraft | undefined;
              if (!previous) {
                finish(undefined);
                return;
              }
              const next = change(previous);
              if (next) drafts.put({ ...next, epoch: session.epoch }, key);
              else {
                // A reopened editor may know only the server ID. Retire every
                // identity in this transaction so it cannot recreate the copy
                // under a different key after the content has been removed.
                const meta = tx.objectStore('meta');
                for (const id of new Set([
                  key,
                  previous.draftId,
                  previous.serverDraftId,
                ])) {
                  if (!id) continue;
                  const generation = meta.get(['generation', id]);
                  generation.onsuccess = () => {
                    if (generation.result)
                      meta.put(true, ['retired', id, generation.result]);
                    meta.put(previous.generation, ['generation', id]);
                    meta.put(true, ['retired', id, previous.generation]);
                  };
                }
                drafts.delete(key);
                for (const attachment of previous.attachments)
                  if (attachment.type === 'local')
                    tx.objectStore('files').delete([key, attachment.id]);
              }
              finish(next);
            };
          },
          finish,
          undefined
        )
      );
    },
    async recordAttempt(
      session: Session,
      attempt: AttemptRecord
    ): Promise<void> {
      await transaction<void>('readwrite', (tx, finish) =>
        withSession(
          tx,
          session,
          () => {
            tx.objectStore('attempts').put(attempt, [
              attempt.storageGeneration,
              attempt.transactionId,
            ]);
            finish();
          },
          finish,
          undefined
        )
      );
    },
    async removeAttempt(
      session: Session,
      storageGeneration: string,
      transactionId: string
    ): Promise<void> {
      await transaction<void>(
        'readwrite',
        (tx, finish) =>
          withSession(
            tx,
            session,
            () => {
              const request = tx.objectStore('attempts').openCursor();
              request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                  finish();
                  return;
                }
                const attempt = cursor.value as AttemptRecord;
                if (
                  attempt.storageGeneration === storageGeneration &&
                  attempt.transactionId === transactionId
                )
                  cursor.delete();
                cursor.continue();
              };
            },
            finish,
            undefined
          ),
        false
      );
    },
    async attempts(session: Session): Promise<AttemptRecord[]> {
      return await transaction(
        'readwrite',
        (tx, finish) =>
          withSession(
            tx,
            session,
            () => {
              const attempts: AttemptRecord[] = [];
              const request = tx.objectStore('attempts').openCursor();
              request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                  finish(attempts);
                  return;
                }
                const attempt = cursor.value as Partial<AttemptRecord>;
                if (
                  typeof attempt.transactionId !== 'string' ||
                  typeof attempt.storageGeneration !== 'string'
                )
                  cursor.delete();
                else if (attempt.accountId === session.accountId)
                  attempts.push(attempt as AttemptRecord);
                cursor.continue();
              };
            },
            finish,
            []
          ),
        false
      );
    },
    async clear(retire = false, expectedEpoch?: string): Promise<void> {
      await transaction<void>('readwrite', (tx, finish) => {
        const meta = tx.objectStore('meta');
        const request = meta.get('session');
        request.onsuccess = () => {
          const previous = request.result as Session | undefined;
          if (expectedEpoch && previous && previous.epoch !== expectedEpoch) {
            finish();
            return;
          }
          for (const name of STORES) tx.objectStore(name).clear();
          if (retire && previous)
            meta.put(true, ['retired-session', previous.epoch]);
          finish();
        };
      });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      if (connection) (await connection).close();
      connection = undefined;
      try {
        channel?.close();
      } catch {
        /* Closing notifications cannot retain the database. */
      }
      channel = undefined;
    },
  };
}
