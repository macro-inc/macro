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

export function isEmailSendIntent(value: unknown): value is EmailSendIntent {
  if (
    !isRecord(value) ||
    typeof value.uuid !== 'string' ||
    value.dispatchVersion !== 2 ||
    !['pending', 'committed', 'failed'].includes(String(value.phase)) ||
    typeof value.locallyCancelled !== 'boolean' ||
    !optionalBoolean(value.submissionStarted) ||
    !optionalBoolean(value.cancellationRequested)
  )
    return false;
  const metadata = value.metadata;
  if (
    !isRecord(metadata) ||
    metadata.kind !== 'email-send-v1' ||
    !isRecord(metadata.payload) ||
    !optionalBoolean(metadata.requiresServerConfirmation)
  )
    return false;
  const { input, draft, workingCopy } = metadata.payload;
  if (
    !isRecord(input) ||
    !isRecord(input.attempt) ||
    input.attempt.attemptId !== value.uuid ||
    typeof input.attempt.linkId !== 'string' ||
    !isRecord(input.message) ||
    typeof input.message.draftId !== 'string' ||
    typeof input.message.subject !== 'string' ||
    !optionalStrings(input.attachmentIds) ||
    !optionalStrings(input.forwardedAttachmentIds) ||
    !isRecord(draft) ||
    typeof draft.draftId !== 'string' ||
    typeof draft.subject !== 'string' ||
    typeof draft.threadDbId !== 'string' ||
    typeof draft.senderLinkId !== 'string' ||
    typeof draft.senderEmail !== 'string'
  )
    return false;
  for (const field of ['to', 'cc', 'bcc']) {
    const recipients = input.message[field];
    if (
      recipients != null &&
      (!Array.isArray(recipients) ||
        !recipients.every(
          (entry) => isRecord(entry) && typeof entry.email === 'string'
        ))
    )
      return false;
  }
  if (
    workingCopy !== undefined &&
    (!isRecord(workingCopy) ||
      typeof workingCopy.key !== 'string' ||
      typeof workingCopy.generation !== 'string' ||
      !Number.isSafeInteger(workingCopy.revision) ||
      !Array.isArray(workingCopy.attachments) ||
      !workingCopy.attachments.every(
        (file) =>
          isRecord(file) &&
          ['local', 'remote', 'forwarded', 'native'].includes(
            String(file.type)
          ) &&
          typeof file.attachmentId === 'string' &&
          (file.type !== 'local' || file.uploaded === true)
      ))
  )
    return false;
  if (value.dispatch !== undefined) {
    const dispatch = value.dispatch;
    if (
      !isRecord(dispatch) ||
      !['generation', 'leaseUntil', 'nextAttemptAt', 'failures'].every(
        (key) =>
          typeof dispatch[key] === 'number' &&
          Number.isFinite(dispatch[key]) &&
          dispatch[key] >= 0
      ) ||
      !optionalBoolean(dispatch.paused)
    )
      return false;
  }
  if (value.response != null) {
    if (!isRecord(value.response)) return false;
    for (const key of ['sendEmailMessage', 'cancelEmailSend']) {
      const response = value.response[key];
      if (response === undefined) continue;
      if (
        !isRecord(response) ||
        !isRecord(response.attempt) ||
        response.attempt.attemptId !== value.uuid ||
        !statuses.has(String(response.attempt.status)) ||
        (response.attempt.message != null &&
          (!isRecord(response.attempt.message) ||
            typeof response.attempt.message.id !== 'string' ||
            typeof response.attempt.message.threadId !== 'string'))
      )
        return false;
    }
  }
  return true;
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
