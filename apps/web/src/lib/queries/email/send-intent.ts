import type {
  EmailSendAttemptFieldsFragment,
  SendEmailAttemptInput,
} from '@service-storage/graphql/generated/graphql';
import { createSignal } from 'solid-js';
import type { GraphqlSaveEmailDraftArgs } from './graphql/draft';
import type { SendWorkingCopy } from './send-draft-lifecycle';

/** Persisted independently of the optimistic layer, including after rejection. */
export type EmailSendIntent = {
  uuid: string;
  /** Owner assigned atomically when the intent is persisted. */
  accountId?: string;
  /** Version 2 is dispatched from the email store, independently of the cache. */
  dispatchVersion: 2;
  submissionStarted?: boolean;
  dispatch?: {
    generation: number;
    owner?: string;
    leaseUntil: number;
    nextAttemptAt: number;
    failures: number;
    cancelling?: boolean;
    error?: string;
    paused?: boolean;
  };
  cancellationRequested?: boolean;
  /** Canonical IDs returned by server acceptance. */
  resolvedDraftId?: string;
  resolvedThreadId?: string;
  phase: 'pending' | 'committed' | 'failed';
  locallyCancelled: boolean;
  metadata: {
    kind: 'email-send-v1';
    requiresServerConfirmation?: boolean;
    payload: {
      workingCopy?: SendWorkingCopy;
      input: SendEmailAttemptInput;
      draft: GraphqlSaveEmailDraftArgs;
    };
  };
  response?: {
    sendEmailMessage?: { attempt: EmailSendAttemptFieldsFragment };
    cancelEmailSend?: { attempt: EmailSendAttemptFieldsFragment };
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const statuses = new Set([
  'ACCEPTED',
  'SENDING',
  'SENT',
  'CANCELLED',
  'FAILED',
  'DELIVERY_UNCONFIRMED',
]);
const optionalBoolean = (value: unknown) =>
  value === undefined || typeof value === 'boolean';
const optionalStrings = (value: unknown) =>
  value == null ||
  (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));

function hasValidSendState(value: Record<string, unknown>): boolean {
  return (
    typeof value.uuid === 'string' &&
    value.dispatchVersion === 2 &&
    ['pending', 'committed', 'failed'].includes(String(value.phase)) &&
    typeof value.locallyCancelled === 'boolean' &&
    optionalBoolean(value.submissionStarted) &&
    optionalBoolean(value.cancellationRequested)
  );
}

function hasValidRecipients(message: Record<string, unknown>): boolean {
  return ['to', 'cc', 'bcc'].every((field) => {
    const recipients = message[field];
    return (
      recipients == null ||
      (Array.isArray(recipients) &&
        recipients.every(
          (entry) => isRecord(entry) && typeof entry.email === 'string'
        ))
    );
  });
}

function isValidAttemptInput(input: unknown, uuid: unknown): boolean {
  return (
    isRecord(input) &&
    isRecord(input.attempt) &&
    input.attempt.attemptId === uuid &&
    typeof input.attempt.linkId === 'string' &&
    isRecord(input.message) &&
    typeof input.message.draftId === 'string' &&
    typeof input.message.subject === 'string' &&
    optionalStrings(input.attachmentIds) &&
    optionalStrings(input.forwardedAttachmentIds) &&
    hasValidRecipients(input.message)
  );
}

function isValidDraftArgs(draft: unknown): boolean {
  return (
    isRecord(draft) &&
    typeof draft.draftId === 'string' &&
    typeof draft.subject === 'string' &&
    typeof draft.threadDbId === 'string' &&
    typeof draft.senderLinkId === 'string' &&
    typeof draft.senderEmail === 'string'
  );
}

function isValidWorkingCopy(workingCopy: unknown): boolean {
  return (
    isRecord(workingCopy) &&
    typeof workingCopy.key === 'string' &&
    typeof workingCopy.generation === 'string' &&
    Number.isSafeInteger(workingCopy.revision) &&
    Array.isArray(workingCopy.attachments) &&
    workingCopy.attachments.every(
      (file) =>
        isRecord(file) &&
        ['local', 'remote', 'forwarded', 'native'].includes(
          String(file.type)
        ) &&
        typeof file.attachmentId === 'string' &&
        (file.type !== 'local' || file.uploaded === true)
    )
  );
}

function isValidDispatch(dispatch: unknown): boolean {
  return (
    isRecord(dispatch) &&
    ['generation', 'leaseUntil', 'nextAttemptAt', 'failures'].every(
      (key) =>
        typeof dispatch[key] === 'number' &&
        Number.isFinite(dispatch[key]) &&
        dispatch[key] >= 0
    ) &&
    optionalBoolean(dispatch.paused)
  );
}

function isValidAttemptResponse(response: unknown, uuid: unknown): boolean {
  if (response === undefined) return true;
  if (
    !isRecord(response) ||
    !isRecord(response.attempt) ||
    response.attempt.attemptId !== uuid ||
    !statuses.has(String(response.attempt.status))
  )
    return false;
  const message = response.attempt.message;
  return (
    message == null ||
    (isRecord(message) &&
      typeof message.id === 'string' &&
      typeof message.threadId === 'string')
  );
}

function isValidResponse(response: unknown, uuid: unknown): boolean {
  return (
    isRecord(response) &&
    ['sendEmailMessage', 'cancelEmailSend'].every((key) =>
      isValidAttemptResponse(response[key], uuid)
    )
  );
}

export function isEmailSendIntent(value: unknown): value is EmailSendIntent {
  if (!isRecord(value) || !hasValidSendState(value)) return false;
  const metadata = value.metadata;
  if (
    !isRecord(metadata) ||
    metadata.kind !== 'email-send-v1' ||
    !isRecord(metadata.payload) ||
    !optionalBoolean(metadata.requiresServerConfirmation)
  )
    return false;
  const { input, draft, workingCopy } = metadata.payload;
  return (
    isValidAttemptInput(input, value.uuid) &&
    isValidDraftArgs(draft) &&
    (workingCopy === undefined || isValidWorkingCopy(workingCopy)) &&
    (value.dispatch === undefined || isValidDispatch(value.dispatch)) &&
    (value.response == null || isValidResponse(value.response, value.uuid))
  );
}

/** The latest server attempt recorded for the send. */
export function emailSendAttempt(intent: EmailSendIntent) {
  return (
    intent.response?.cancelEmailSend?.attempt ??
    intent.response?.sendEmailMessage?.attempt
  );
}

/** The latest server status recorded for the send's attempt. */
export function emailSendAttemptStatus(intent: EmailSendIntent) {
  return (
    intent.response?.cancelEmailSend?.attempt.status ??
    intent.response?.sendEmailMessage?.attempt.status
  );
}

/** Even an unsupported record keeps recognizable identities reserved. */
export function emailSendReservedDraftIds(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const payload =
    isRecord(value.metadata) && isRecord(value.metadata.payload)
      ? value.metadata.payload
      : undefined;
  const input = payload && isRecord(payload.input) ? payload.input : undefined;
  const message = input && isRecord(input.message) ? input.message : undefined;
  const copy =
    payload && isRecord(payload.workingCopy) ? payload.workingCopy : undefined;
  const draft = payload && isRecord(payload.draft) ? payload.draft : undefined;
  return [
    value.resolvedDraftId,
    message?.draftId,
    copy?.key,
    draft?.draftId,
  ].filter((id): id is string => typeof id === 'string');
}

const [emailSendStorageWarning, setStorageWarning] = createSignal<string>();

export { emailSendStorageWarning };

/** Preserve damaged/unsupported records while allowing unrelated valid sends to proceed. */
export function usableEmailSendIntents(
  rows: readonly unknown[]
): EmailSendIntent[] {
  const valid = rows.filter(isEmailSendIntent);
  setStorageWarning(
    valid.length === rows.length
      ? undefined
      : 'A saved email needs recovery. Its contents are preserved on this device. Contact support before clearing storage.'
  );
  return valid;
}
