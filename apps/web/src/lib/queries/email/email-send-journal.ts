import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import { deepEqual } from '@core/util/compareUtils';
import type { EmailSendAttemptFieldsFragment } from '@service-storage/graphql/generated/graphql';
import {
  type RestoredEmailSend,
  restoreEmailSendTransaction,
} from './email-send-restoration';
import type { DraftStorageSession as Session } from './local-draft-store';
import {
  type EmailSendIntent,
  emailSendReservedDraftIds,
  isEmailSendIntent,
} from './send-intent';

export function restoreEmailSendLocks(tx: IDBTransaction, accountId: string) {
  const request = tx.objectStore('sends').getAll();
  request.onsuccess = () => {
    for (const row of request.result as EmailSendIntent[]) {
      if (row?.accountId !== accountId) continue;
      for (const id of emailSendReservedDraftIds(row))
        if (id) tx.objectStore('meta').put(row.uuid, ['send-lock', id]);
    }
  };
}

type Transaction = <T>(
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction, finish: (value: T) => void) => void,
  publish?: boolean
) => Promise<T>;
type WithSession = <T>(
  tx: IDBTransaction,
  session: Session,
  run: () => void,
  finish: (value: T) => void,
  stale: T
) => void;

/** Email-specific transactions share the working-copy database and account fence. */
export function createEmailSendJournal(
  transaction: Transaction,
  withSession: WithSession
) {
  return {
    /** Backup and reservation commit before any send can leave this device. */
    async putSend(
      session: Session,
      intent: EmailSendIntent,
      reserve = false
    ): Promise<EmailSendIntent> {
      const result = await transaction<EmailSendIntent | Error | undefined>(
        'readwrite',
        (tx, finish) =>
          withSession(
            tx,
            session,
            () => {
              const sends = tx.objectStore('sends');
              const request = sends.getAll();
              request.onsuccess = () => {
                const all = request.result as EmailSendIntent[];
                const previous = all.find((row) => row?.uuid === intent.uuid);
                if (!previous && !reserve) {
                  finish(new Error('This send was already resolved'));
                  return;
                }
                if (
                  (previous && previous.accountId !== session.accountId) ||
                  (intent.accountId && intent.accountId !== session.accountId)
                ) {
                  finish(new Error('This send belongs to another account'));
                  return;
                }
                if (
                  previous &&
                  !deepEqual(
                    previous.metadata.payload.input,
                    intent.metadata.payload.input
                  )
                ) {
                  finish(new Error('Approved send content cannot be changed'));
                  return;
                }
                const rows = all.filter(
                  (row) => row?.accountId === session.accountId
                );
                const ids = emailSendReservedDraftIds;
                if (
                  reserve &&
                  rows.some(
                    (row) =>
                      row.uuid !== intent.uuid &&
                      ids(row).some((id) => id && ids(intent).includes(id))
                  )
                ) {
                  finish(new Error('This draft is already queued for sending'));
                  return;
                }
                const persist = () => {
                  // A late send settlement must not erase a cancellation or restoration.
                  const next = {
                    ...intent,
                    accountId: session.accountId,
                    dispatchVersion:
                      previous?.dispatchVersion ?? intent.dispatchVersion,
                    submissionStarted:
                      previous?.submissionStarted || intent.submissionStarted,
                    dispatch: previous?.dispatch ?? intent.dispatch,
                    // Only the dispatcher may settle v2 authority. A late
                    // composer/status callback cannot regress its response.
                    ...(previous
                      ? {
                          phase: previous.phase,
                          response: previous.response,
                          resolvedDraftId: previous.resolvedDraftId,
                          resolvedThreadId: previous.resolvedThreadId,
                          locallyCancelled: previous.locallyCancelled,
                          metadata: {
                            ...intent.metadata,
                            requiresServerConfirmation:
                              previous.metadata.requiresServerConfirmation,
                          },
                        }
                      : {}),
                    cancellationRequested:
                      previous?.cancellationRequested ||
                      intent.cancellationRequested,
                  };
                  if (next.cancellationRequested && !next.submissionStarted) {
                    next.locallyCancelled = true;
                    next.metadata = {
                      ...next.metadata,
                      requiresServerConfirmation: false,
                    };
                  }
                  if (
                    next.cancellationRequested &&
                    !previous?.cancellationRequested &&
                    next.dispatch
                  ) {
                    next.dispatch = { ...next.dispatch, nextAttemptAt: 0 };
                  }
                  sends.put(next, intent.uuid);
                  for (const id of ids(next))
                    if (id)
                      tx.objectStore('meta').put(intent.uuid, [
                        'send-lock',
                        id,
                      ]);
                  finish(next);
                };
                const copy = intent.metadata.payload.workingCopy;
                if (!reserve || !copy) {
                  persist();
                  return;
                }
                const draft = tx.objectStore('drafts').get(copy.key);
                draft.onsuccess = () => {
                  const current = draft.result as LocalDraft | undefined;
                  if (
                    !current ||
                    current.generation !== copy.generation ||
                    current.revision !== copy.revision
                  ) {
                    finish(
                      new Error('This draft changed while preparing the send')
                    );
                    return;
                  }
                  persist();
                };
              };
            },
            finish,
            new Error('This draft session is no longer active')
          )
      );
      if (result instanceof Error) throw result;
      if (!result) throw new Error('This draft session is no longer active');
      return result;
    },
    async requestSendCheck(session: Session, uuid: string): Promise<void> {
      await transaction<void>('readwrite', (tx, finish) =>
        withSession(
          tx,
          session,
          () => {
            const sends = tx.objectStore('sends');
            const request = sends.get(uuid);
            request.onsuccess = () => {
              const row = request.result as EmailSendIntent | undefined;
              if (row?.accountId === session.accountId && row.dispatch) {
                sends.put(
                  {
                    ...row,
                    phase:
                      row.phase === 'failed' && !row.response
                        ? 'pending'
                        : row.phase,
                    dispatch: {
                      ...row.dispatch,
                      nextAttemptAt: 0,
                      paused: false,
                    },
                  },
                  uuid
                );
              }
              finish();
            };
          },
          finish,
          undefined
        )
      );
    },
    async restoreSend(
      session: Session,
      uuid: string
    ): Promise<RestoredEmailSend | undefined> {
      // Kept across replays so one can recognize a restore that already landed.
      let landed: RestoredEmailSend | undefined;
      const result = await transaction<RestoredEmailSend | Error | undefined>(
        'readwrite',
        (tx, finish) =>
          withSession(
            tx,
            session,
            () =>
              restoreEmailSendTransaction(
                tx,
                session,
                uuid,
                (value) => {
                  if (value && !(value instanceof Error)) landed = value;
                  finish(value);
                },
                landed
              ),
            finish,
            undefined
          )
      );
      if (result instanceof Error) throw result;
      return result;
    },
    /** Claim and persist the submission boundary before any HTTP can start. */
    async claimSend(
      session: Session,
      uuid: string,
      worker: string,
      now: number
    ): Promise<EmailSendIntent | undefined> {
      return await transaction(
        'readwrite',
        (tx, finish) =>
          withSession(
            tx,
            session,
            () => {
              const sends = tx.objectStore('sends');
              const request = sends.get(uuid);
              request.onsuccess = () => {
                const row = request.result as EmailSendIntent | undefined;
                const status =
                  row?.response?.cancelEmailSend?.attempt.status ??
                  row?.response?.sendEmailMessage?.attempt.status;
                if (
                  !row ||
                  row.accountId !== session.accountId ||
                  row.dispatch?.paused ||
                  status === 'SENT' ||
                  status === 'CANCELLED' ||
                  (!row.cancellationRequested &&
                    (row.phase === 'failed' || status === 'FAILED')) ||
                  row.locallyCancelled ||
                  (row.dispatch?.leaseUntil ?? 0) > now ||
                  (row.dispatch?.nextAttemptAt ?? 0) > now
                ) {
                  finish(undefined);
                  return;
                }
                const next: EmailSendIntent = {
                  ...row,
                  submissionStarted: true,
                  metadata: {
                    ...row.metadata,
                    requiresServerConfirmation: true,
                  },
                  dispatch: {
                    generation: (row.dispatch?.generation ?? 0) + 1,
                    owner: worker,
                    leaseUntil: now + 60_000,
                    nextAttemptAt: 0,
                    failures: row.dispatch?.failures ?? 0,
                    cancelling: row.cancellationRequested,
                  },
                };
                sends.put(next, uuid);
                finish(next);
              };
            },
            finish,
            undefined
          ),
        false
      );
    },
    /** A timed-out worker cannot settle a newer claim or another account. */
    async settleSend(
      session: Session,
      uuid: string,
      worker: string,
      generation: number,
      update: {
        attempt?: EmailSendAttemptFieldsFragment;
        error?: string;
        failed?: boolean;
        paused?: boolean;
        rejectedBeforeAdmission?: boolean;
        nextAttemptAt: number;
      }
    ): Promise<boolean> {
      return await transaction('readwrite', (tx, finish) =>
        withSession(
          tx,
          session,
          () => {
            const sends = tx.objectStore('sends');
            const request = sends.get(uuid);
            request.onsuccess = () => {
              const row = request.result as EmailSendIntent | undefined;
              if (
                !row ||
                row.accountId !== session.accountId ||
                row.dispatch?.owner !== worker ||
                row.dispatch.generation !== generation
              ) {
                finish(false);
                return;
              }
              sends.put(
                {
                  ...row,
                  ...(update.rejectedBeforeAdmission &&
                  generation === 1 &&
                  row.dispatchVersion === 2 &&
                  !row.response &&
                  !update.attempt
                    ? {
                        locallyCancelled: true,
                        metadata: {
                          ...row.metadata,
                          requiresServerConfirmation: false,
                        },
                      }
                    : {}),
                  phase: update.attempt
                    ? 'committed'
                    : update.failed
                      ? 'failed'
                      : row.phase,
                  response: update.attempt
                    ? { sendEmailMessage: { attempt: update.attempt } }
                    : row.response,
                  resolvedDraftId:
                    update.attempt?.message?.id ?? row.resolvedDraftId,
                  resolvedThreadId:
                    update.attempt?.threadId ?? row.resolvedThreadId,
                  dispatch: {
                    generation,
                    leaseUntil: 0,
                    nextAttemptAt:
                      row.cancellationRequested && !row.dispatch.cancelling
                        ? 0
                        : update.nextAttemptAt,
                    failures: update.error ? row.dispatch.failures + 1 : 0,
                    error: update.error,
                    paused: update.paused,
                  },
                } satisfies EmailSendIntent,
                uuid
              );
              finish(true);
            };
          },
          finish,
          false
        )
      );
    },
    async sends(session: Session): Promise<EmailSendIntent[]> {
      return await transaction('readonly', (tx, finish) =>
        withSession(
          tx,
          session,
          () => {
            const request = tx.objectStore('sends').getAll();
            request.onsuccess = () =>
              finish(
                (request.result as EmailSendIntent[]).filter(
                  (row) => row?.accountId === session.accountId
                )
              );
          },
          finish,
          []
        )
      );
    },
    async removeSend(session: Session, uuid: string): Promise<void> {
      await transaction<void>('readwrite', (tx, finish) =>
        withSession(
          tx,
          session,
          () => {
            const request = tx.objectStore('sends').get(uuid);
            request.onsuccess = () => {
              const row = request.result as EmailSendIntent | undefined;
              if (row?.accountId !== session.accountId) {
                finish();
                return;
              }
              if (!isEmailSendIntent(row)) {
                finish();
                return;
              }
              const sent =
                (
                  row.response?.cancelEmailSend?.attempt ??
                  row.response?.sendEmailMessage?.attempt
                )?.status === 'SENT';
              if (!sent) {
                finish();
                return;
              }
              if (row)
                for (const id of [
                  row.resolvedDraftId,
                  String(row.metadata.payload.input.message.draftId),
                  row.metadata.payload.workingCopy?.key,
                ]) {
                  if (!id) continue;
                  const lock = tx.objectStore('meta').get(['send-lock', id]);
                  lock.onsuccess = () => {
                    if (lock.result === uuid)
                      tx.objectStore('meta').delete(['send-lock', id]);
                  };
                }
              tx.objectStore('sends').delete(uuid);
              finish();
            };
          },
          finish,
          undefined
        )
      );
    },
  };
}
