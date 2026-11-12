import { dssFetch } from './client';
import type { EmailPrivacyChange } from './generated/schemas/emailPrivacyChange';
import type { EmailPrivacySettings } from './generated/schemas/emailPrivacySettings';

export type CrmEmailPrivacyResponse = EmailPrivacySettings;
export type CrmEmailPrivacyRequest = EmailPrivacyChange;

export const crmEmailPrivacyClient = {
  get: () => dssFetch<CrmEmailPrivacyResponse>('/crm/email-privacy'),
  update: (body: CrmEmailPrivacyRequest) =>
    dssFetch<CrmEmailPrivacyResponse>('/crm/email-privacy', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};
