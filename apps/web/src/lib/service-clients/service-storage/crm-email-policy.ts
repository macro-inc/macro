import { statusError } from '@core/util/safeFetch';
import { match, P } from 'ts-pattern';
import { dssFetch } from './client';
import { errorBody } from './databases';
import type { EmailPolicyCommand } from './generated/schemas/emailPolicyCommand';
import type { EmailPolicyHistory } from './generated/schemas/emailPolicyHistory';
import type { EmailPolicyOutcome } from './generated/schemas/emailPolicyOutcome';
import type { EmailPolicyRevision } from './generated/schemas/emailPolicyRevision';
import type { EmailPolicyView } from './generated/schemas/emailPolicyView';
import type { EmailPreviewRequest } from './generated/schemas/emailPreviewRequest';
import type { EmailPreviewView } from './generated/schemas/emailPreviewView';
import type { EmailRuleValidation } from './generated/schemas/emailRuleValidation';

/** Preserve bounded validation/limit refusals, including rate and size limits. */
export async function emailPolicyError(response: Response) {
  const fallback = statusError(response.status);
  if (response.status < 400 || response.status >= 500) return fallback;
  const { body } = await errorBody(response);
  return match(body)
    .with({ message: P.string }, ({ message }) => ({
      ...fallback,
      message: message || fallback.message,
    }))
    .otherwise(() => fallback);
}

const POLICY_PATH = '/crm/email-privacy/policy';

export const crmEmailPolicyClient = {
  get: (signal?: AbortSignal) =>
    dssFetch<EmailPolicyView>(POLICY_PATH, { signal }),
  // Send the original JSON: the server must see unknown fields and report
  // canonicalization/limit failures rather than a client silently dropping them.
  validate: (json: string, signal?: AbortSignal) =>
    dssFetch<EmailRuleValidation>(`${POLICY_PATH}/validate`, {
      method: 'POST',
      body: json,
      signal,
      errorResponseHandler: emailPolicyError,
    }),
  replace: (body: EmailPolicyCommand) =>
    dssFetch<EmailPolicyOutcome>(POLICY_PATH, {
      method: 'PUT',
      body: JSON.stringify(body),
      errorResponseHandler: emailPolicyError,
    }),
  history: (before?: string, signal?: AbortSignal) =>
    dssFetch<EmailPolicyHistory>(
      `${POLICY_PATH}/history?${new URLSearchParams(before ? { before } : {})}`,
      { signal }
    ),
  revision: (revision: number, signal?: AbortSignal) =>
    dssFetch<EmailPolicyRevision | null>(
      `${POLICY_PATH}/revisions/${revision}`,
      {
        signal,
      }
    ),
  preview: (signal?: AbortSignal) =>
    dssFetch<EmailPreviewView | null>(`${POLICY_PATH}/preview`, { signal }),
  startPreview: (body: EmailPreviewRequest, signal?: AbortSignal) =>
    dssFetch<EmailPreviewView>(`${POLICY_PATH}/preview`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
      errorResponseHandler: emailPolicyError,
    }),
  cancelPreview: (id: string, signal?: AbortSignal) =>
    dssFetch(`${POLICY_PATH}/preview/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
      errorResponseHandler: emailPolicyError,
    }),
};
