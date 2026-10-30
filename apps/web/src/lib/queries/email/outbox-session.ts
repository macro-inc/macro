import { reloadApp } from '@app/observability/reload';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  cancelEmailSend,
  readEmailSendStatus,
  submitEmailSend,
} from '@service-storage/email-send';
import { queryPersistence } from '../client';
import { createEmailSendDispatcher } from './email-send-dispatcher';
import { createEmailSendRecovery } from './email-send-recovery';
import {
  emailStorageSession,
  localDraftStore,
  watchEmailStorageEnded,
} from './local-drafts';
import {
  emailSendFailureKind,
  recordEmailSend,
  traceEmailSend,
} from './send-telemetry';
import { setServerSendSession } from './server-sends';

let account: string | undefined;
let generation = 0;
let dispatcher: ReturnType<typeof createEmailSendDispatcher> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let recovery: ReturnType<typeof createEmailSendRecovery> | undefined;
let stopWatching: (() => void) | undefined;

/** Called by the authenticated app shell, not by individual email surfaces. */
export function setEmailOutboxSession(accountId: string | undefined): void {
  if (account === accountId) return;
  account = accountId;
  const current = ++generation;
  if (retry !== undefined) clearTimeout(retry);
  dispatcher?.dispose();
  recovery?.dispose();
  recovery = undefined;
  dispatcher = undefined;
  stopWatching?.();
  stopWatching = undefined;
  setServerSendSession(accountId);
  if (!accountId) return;
  // This page's draft session ended outside it; only a new page can reopen
  // drafts. This page's own sign-out clears the account first, so it never
  // reloads here.
  stopWatching = watchEmailStorageEnded(accountId, () =>
    fireAndForget(reloadForNewSession(), 'email-outbox')
  );
  fireAndForget(start(accountId, current), 'email-outbox');
}

/** Persist the current identity first, or the new page could restore the old one and reload again. */
async function reloadForNewSession() {
  try {
    await queryPersistence.flush();
  } finally {
    reloadApp('logout');
  }
}

async function start(accountId: string, current: number) {
  let session: Awaited<ReturnType<typeof emailStorageSession>>;
  try {
    session = await emailStorageSession();
  } catch (error) {
    if (current === generation) {
      retry = setTimeout(() => {
        fireAndForget(start(accountId, current), 'email-outbox');
      }, 5_000);
    }
    throw error;
  }
  if (current !== generation || session.accountId !== accountId) return;
  recovery = createEmailSendRecovery(accountId);
  dispatcher = createEmailSendDispatcher({
    session,
    journal: localDraftStore,
    submit: (intent, signal) =>
      traceEmailSend('submit', intent.metadata.payload.input.attempt, () =>
        submitEmailSend(intent.metadata.payload.input, signal)
      ),
    cancel: (intent, signal) =>
      traceEmailSend('cancel', intent.metadata.payload.input.attempt, () =>
        cancelEmailSend(intent.metadata.payload.input.attempt, signal)
      ),
    status: (intent, signal) =>
      traceEmailSend('status', intent.metadata.payload.input.attempt, () =>
        readEmailSendStatus(intent.metadata.payload.input.attempt, signal)
      ),
    report: (intent, error) =>
      recordEmailSend(
        {
          operation: 'recover',
          outcome: error ? 'error' : 'completed',
          failureKind: error ? emailSendFailureKind(error) : undefined,
        },
        intent
      ),
  });
}
