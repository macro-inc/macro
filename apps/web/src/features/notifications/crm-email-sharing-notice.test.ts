import { mapGraphqlNotification } from '@service-storage/graphql-soup';
import { describe, expect, it } from 'vitest';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  shouldShowNotificationTarget,
} from './notification-metadata';

const TEAM = '019a0000-0000-7000-8000-0000000000aa';

const notice = mapGraphqlNotification({
  __typename: 'GraphqlNotification',
  id: '019a0000-0000-7000-8000-0000000000ab',
  eventType: 'crm_email_sharing_changed',
  metadata: {
    __typename: 'GraphqlCrmEmailSharingChangedMetadata',
    crmEmailSharingChangedTeamId: TEAM,
    crmEmailSharingChangedReason: 'COMPANIES_MERGED',
  },
  entityId: 'macro|sharer@example.com',
  targetEntityType: 'USER',
  sent: true,
  state: { __typename: 'GraphqlNotificationState', done: false, seen: false },
  createdAt: '2026-11-25T00:00:00Z',
  viewedAt: null,
  updatedAt: '2026-11-25T00:00:00Z',
  senderId: null,
} as unknown as Parameters<typeof mapGraphqlNotification>[0]);

describe('CRM email sharing notice', () => {
  it('reads the notice from GraphQL with only its team and reason', () => {
    expect(notice.notification_metadata).toEqual({
      tag: 'crm_email_sharing_changed',
      content: { teamId: TEAM, reason: 'companies_merged' },
    });
    expect(notice.sender_id).toBeUndefined();
  });

  it('says the rules changed without naming companies, counts or who did it', () => {
    const unified = notice as unknown as Parameters<
      typeof getNotificationAction
    >[0];
    expect(getNotificationAction(unified)).toBe('changed');
    expect(getNotificationTargetName(unified)).toBeUndefined();
    expect(shouldShowNotificationTarget(unified)).toBe(false);
    expect(getNotificationContent(unified)).toBe(
      'Companies your sharing rules named were merged, so your rules were updated.'
    );
  });
});
