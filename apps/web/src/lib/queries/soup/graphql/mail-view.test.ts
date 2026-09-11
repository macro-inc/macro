import type { MailItemFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { describe, expect, it } from 'vitest';
import { isCachedMailView, materializeMailView } from './mail-view';

const preview = (subject: string, isDraft: boolean) => ({
  id: subject,
  subject,
  snippet: `${subject} snippet`,
  isDraft,
  senderEmail: `${subject}@example.com`,
  senderName: subject,
  senderPhotoUrl: null,
});
const record = {
  __typename: 'GraphqlSoupEmailThread',
  id: 'thread',
  emailName: 'wrong last-query preview',
  isDraft: false,
  mailAllPreview: preview('newest-normal', false),
  mailDraftPreview: preview('older-draft', true),
  mailSentPreview: preview('older-sent', false),
} as unknown as MailItemFieldsFragment;
describe('canonical offline Mail preview', () => {
  it('chooses view-specific message fields without changing normalized thread data', () => {
    for (const [view, subject, draft] of [
      ['ALL', 'newest-normal', false],
      ['INBOX', 'newest-normal', false],
      ['DRAFTS', 'older-draft', true],
      ['SENT', 'older-sent', false],
    ] as const) {
      const result = materializeMailView(record, view, '2025-01-01T00:00:00Z');
      expect(result).toMatchObject({
        emailName: subject,
        snippet: `${subject} snippet`,
        isDraft: draft,
        senderEmail: `${subject}@example.com`,
        sortTs: '2025-01-01T00:00:00Z',
      });
    }
    expect(record).toMatchObject({
      emailName: 'wrong last-query preview',
      isDraft: false,
    });
  });
  it('never fabricates a draft preview from ALL or missing message data', () => {
    expect(
      materializeMailView(
        { ...record, mailDraftPreview: null } as MailItemFieldsFragment,
        'DRAFTS',
        'now'
      )
    ).toBeUndefined();
    expect(isCachedMailView('STARRED')).toBe(false);
  });
});
