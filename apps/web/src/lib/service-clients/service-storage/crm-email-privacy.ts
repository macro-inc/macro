import { dssFetch } from './client';
import type { EmailPrivacyChange } from './generated/schemas/emailPrivacyChange';
import type { EmailPrivacySettings } from './generated/schemas/emailPrivacySettings';
import type { ExcludedEmailThreads } from './generated/schemas/excludedEmailThreads';

export type CrmEmailPrivacyResponse = EmailPrivacySettings;
export type CrmEmailPrivacyRequest = EmailPrivacyChange;

export const crmEmailPrivacyClient = {
  excludedThreads: (after?: string, signal?: AbortSignal) =>
    dssFetch<ExcludedEmailThreads>(
      `/crm/email-privacy/threads${after ? `?after=${encodeURIComponent(after)}` : ''}`,
      { signal }
    ),
  get: () => dssFetch<CrmEmailPrivacyResponse>('/crm/email-privacy'),
  update: (body: CrmEmailPrivacyRequest) =>
    dssFetch<CrmEmailPrivacyResponse>('/crm/email-privacy', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};
