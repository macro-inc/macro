import type {
  EmailThreadMessageFieldsFragment,
  EmailThreadPageFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import { describe, expect, it } from 'vitest';
import { mapGraphqlEmailThreadPage } from './mapper';

const message: EmailThreadMessageFieldsFragment = {
  __typename: 'GraphqlSoupEmailMessage',
  id: 'message-1',
  providerId: 'provider-message-1',
  threadId: 'thread-1',
  replyingToId: 'message-0',
  linkId: 'link-1',
  subject: 'Subject',
  snippet: 'Snippet',
  internalDateTs: '2026-08-06T12:00:00Z',
  sentAt: '2026-08-06T12:01:00Z',
  isRead: true,
  isStarred: false,
  isSent: false,
  isDraft: true,
  hasAttachments: true,
  scheduledSendTime: '2026-08-07T12:00:00Z',
  from: { email: 'from@example.com', name: 'From', photoUrl: 'from-photo' },
  to: [{ email: 'to@example.com', name: 'To', photoUrl: null }],
  cc: [],
  bcc: [],
  labels: [{ providerLabelId: 'INBOX', name: 'Inbox' }],
  bodyText: 'Plain text',
  bodyHtmlSanitized: '<p>HTML</p>',
  bodyMacro: 'Macro',
  bodyReplyless: '<p>Replyless</p>',
  attachments: [
    {
      __typename: 'GraphqlSoupEmailMessageAttachment',
      id: 'attachment-1',
      providerId: 'provider-attachment-1',
      filename: 'image.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      sfsId: 'sfs-1',
      contentId: 'cid-1',
    },
  ],
  attachmentsDraft: [
    {
      __typename: 'GraphqlSoupEmailDraftAttachment',
      id: 'draft-attachment-1',
      draftId: 'message-1',
      fileName: 'draft.txt',
      contentType: 'text/plain',
      sha: 'sha',
      size: 20,
      s3Key: 'draft-key',
    },
  ],
  attachmentsForwarded: [
    {
      __typename: 'GraphqlSoupEmailForwardedAttachment',
      attachmentId: 'forwarded-attachment-1',
      draftId: 'message-1',
      providerAttachmentId: 'provider-forwarded-1',
      messageProviderId: 'provider-message-0',
      filename: 'forwarded.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 30,
    },
  ],
  createdAt: '2026-08-06T11:00:00Z',
  updatedAt: '2026-08-06T12:02:00Z',
};

function thread(
  overrides: Partial<EmailThreadPageFieldsFragment> = {}
): EmailThreadPageFieldsFragment {
  return {
    __typename: 'GraphqlSoupEmailThread',
    id: 'thread-1',
    providerId: 'provider-thread-1',
    linkId: 'link-1',
    inboxVisible: true,
    isRead: false,
    projectId: 'project-1',
    latestInboundMessageTs: '2026-08-06T12:00:00Z',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-06T12:02:00Z',
    viewerPermission: {
      __typename: 'GraphqlAccessLevelPermission',
      accessLevel: 'OWNER',
    },
    labels: [
      {
        __typename: 'GraphqlSoupEmailLabel',
        id: 'label-1',
        linkId: 'link-1',
        providerLabelId: 'INBOX',
        name: 'Inbox',
        createdAt: '2026-08-01T00:00:00Z',
        messageListVisibility: 'show',
        labelListVisibility: 'labelShow',
        type: 'system',
      },
    ],
    messages: [message],
    ...overrides,
  };
}

describe('mapGraphqlEmailThreadPage', () => {
  it('maps thread metadata, permissions, messages, and attachments', () => {
    const mapped = mapGraphqlEmailThreadPage(thread());

    expect(mapped).toMatchObject({
      access_level: 'owner',
      db_id: 'thread-1',
      provider_id: 'provider-thread-1',
      link_id: 'link-1',
      inbox_visible: true,
      latest_inbound_message_ts: '2026-08-06T12:00:00Z',
    });
    expect(mapped.messages[0]).toMatchObject({
      db_id: 'message-1',
      provider_id: 'provider-message-1',
      replying_to_id: 'message-0',
      scheduled_send_time: '2026-08-07T12:00:00Z',
      from: { email: 'from@example.com', photo_url: 'from-photo' },
      labels: [
        {
          id: 'label-1',
          link_id: 'link-1',
          provider_label_id: 'INBOX',
        },
      ],
      attachments: [
        {
          db_id: 'attachment-1',
          sfs_id: 'sfs-1',
          content_id: 'cid-1',
        },
      ],
      attachments_draft: [{ id: 'draft-attachment-1', s3_key: 'draft-key' }],
      attachments_forwarded: [
        {
          attachment_id: 'forwarded-attachment-1',
          message_provider_id: 'provider-message-0',
        },
      ],
    });
  });

  it('defaults unknown permission shapes to view-only', () => {
    const mapped = mapGraphqlEmailThreadPage(
      thread({
        viewerPermission: {
          __typename: 'GraphqlTeamRolePermission',
        },
      })
    );

    expect(mapped.access_level).toBe('view');
  });

  it('uses message metadata when a canonical label is unavailable', () => {
    const mapped = mapGraphqlEmailThreadPage(thread({ labels: [] }));

    expect(mapped.messages[0]?.labels[0]).toMatchObject({
      created_at: message.createdAt,
      link_id: message.linkId,
      name: 'Inbox',
      provider_label_id: 'INBOX',
    });
  });
});
