import { mailProjectionCapsules } from '../../../../graphql-cache/worker/browser-test/mail-projection-capsules';
import type {
  MailItemFieldsFragment,
  SoupQuery,
} from '../../../../service-clients/service-storage/graphql/generated/graphql';
import type { SoupLiveQueryInput } from '../create-soup-live-query';

export type MailTab = 'noise' | 'signal' | 'drafts';
export const VIEWER = 'offline-mail-viewer';
export const SERVER_IDS = [20, 16, 8];
export const STALE_IDS = [18, 14, 10];
export const CACHED_IDS = [20, 18, 16, 14, 10, 8];
export const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const NIL = id(0);

export function input(tab: MailTab): SoupLiveQueryInput {
  return {
    filters: {
      documentFilter: { literal: { id: NIL } },
      projectFilter: { literal: { projectIdSelf: NIL } },
      chatFilter: { literal: { chatId: NIL } },
      calendarEventFilter: { literal: { id: NIL } },
      channelFilter: { literal: { channelId: NIL } },
      channelThreadFilter: { literal: { threadId: NIL } },
      callFilter: { literal: { callId: NIL } },
      crmCompanyFilter: { literal: { id: NIL } },
      foreignEntityFilter: { literal: { id: NIL } },
      emailFilter: { tree: { literal: { importance: tab === 'signal' } } },
    },
    emailView: tab === 'drafts' ? 'DRAFTS' : 'INBOX',
    sortMethod: 'UPDATED_AT',
    sortDirection: 'DESC',
    limit: 100,
  };
}

function thread(n: number): MailItemFieldsFragment {
  return {
    __typename: 'GraphqlSoupEmailThread',
    id: id(n),
    entityType: 'EMAIL_THREAD',
    displayName: `Thread ${n}`,
    emailName: `Thread ${n}`,
    providerId: null,
    linkId: id(1000),
    ownerId: VIEWER,
    inboxVisible: true,
    isRead: false,
    isSignal: false,
    isImportant: false,
    isDraft: false,
    projectId: null,
    createdAt: '2025-01-02T00:00:00Z',
    updatedAt: '2025-01-04T00:00:00Z',
    viewedAt: null,
    latestInboundMessageTs: '2025-01-02T00:00:00Z',
    latestOutboundMessageTs: null,
    latestNonSpamMessageTs: '2025-01-03T00:00:00Z',
    reminderReturnedAt: null,
    cacheProjection: mailProjectionCapsules[n - 1],
    frecencyScore: null,
    isFavorited: false,
    properties: [],
    notifications: [],
    participants: [],
    attachments: [],
    labels: [],
    snippet: null,
    senderEmail: null,
    senderName: null,
    senderPhotoUrl: null,
    mailDraftState: null,
    mailAllPreview: {
      id: id(n + 10000),
      subject: `Thread ${n}`,
      snippet: null,
      isDraft: false,
      senderEmail: null,
      senderName: null,
      senderPhotoUrl: null,
    },
    mailDraftPreview: null,
    mailSentPreview: null,
  };
}

export function response(ids: readonly number[]): SoupQuery {
  return {
    user: {
      id: VIEWER,
      emailLinks: [
        {
          id: id(1000),
          macroId: VIEWER,
          provider: 'GMAIL',
          emailAddress: 'mail@example.com',
          photoUrl: null,
          isPrimary: true,
          needsReauth: false,
          draftIsSignal: false,
          settings: { signature: null, signatureOnRepliesForwards: false },
        },
      ],
      soup: { nextCursor: null, items: ids.map(thread) },
    },
  };
}
