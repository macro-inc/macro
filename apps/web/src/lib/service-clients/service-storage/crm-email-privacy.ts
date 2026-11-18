import { dssFetch } from './client';
import { crmValidationError } from './crm-errors';
import type { EmailContributionConsent } from './generated/schemas/emailContributionConsent';
import type { EmailPrivacyChange } from './generated/schemas/emailPrivacyChange';
import type { EmailPrivacySettings } from './generated/schemas/emailPrivacySettings';
import type { ExcludedEmailThreads } from './generated/schemas/excludedEmailThreads';

export type CrmEmailPrivacyResponse = EmailPrivacySettings;
export type CrmEmailConsentResponse = EmailContributionConsent;
export type CrmEmailPrivacyRequest = EmailPrivacyChange;

export const crmEmailPrivacyClient = {
  excludedThreads: (after?: string, signal?: AbortSignal, threadId?: string) =>
    dssFetch<ExcludedEmailThreads>(
      `/crm/email-privacy/threads?${new URLSearchParams({
        ...(after ? { after } : {}),
        ...(threadId ? { thread_id: threadId } : {}),
      })}`,
      { signal }
    ),
  get: () => dssFetch<CrmEmailPrivacyResponse>('/crm/email-privacy'),
  getConsent: (signal?: AbortSignal) =>
    dssFetch<CrmEmailConsentResponse>('/crm/email-privacy?consent_only=true', {
      signal,
    }),
  update: (body: CrmEmailPrivacyRequest) =>
    dssFetch<CrmEmailPrivacyResponse>('/crm/email-privacy', {
      method: 'PUT',
      body: JSON.stringify(body),
      errorResponseHandler: crmValidationError,
    }),
};
