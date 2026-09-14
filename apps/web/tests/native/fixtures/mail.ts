import { mailProjectionCapsules } from '../../../src/lib/graphql-cache/worker/browser-test/mail-projection-capsules';

export const USER_ID = 'macro|offline@example.com';
export const EMAIL = 'offline@example.com';
export const fixtureId = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const timestamp = '2025-01-04T00:00:00Z';

export const accounts = [
  { id: fixtureId(1000), emailAddress: EMAIL, photoUrl: null },
];

/** Subset of the canonical Rust-encoded Mail fixtures. These are API records,
 * not cache writes or precomputed filter results. Keep the capsule facts intact. */
export const mail = [4, 6, 8, 9, 10, 12].map((n) => {
  const preview = (offset: number, subject: string, isDraft: boolean) => ({
    id: fixtureId(n + offset),
    subject,
    snippet: subject,
    isDraft,
    senderEmail: 'sender@example.com',
    senderName: 'Fixture sender',
    senderPhotoUrl: null,
  });
  return {
    __typename: 'GraphqlSoupEmailThread',
    id: fixtureId(n),
    entityType: 'EMAIL_THREAD',
    name: `Email ${n}`,
    displayName: `Email ${n}`,
    ownerId: USER_ID,
    linkId: accounts[0].id,
    cacheProjection: mailProjectionCapsules[n - 1],
    mailAllPreview: preview(10000, `Email ${n}`, false),
    mailDraftPreview: n % 3 === 0 ? preview(20000, `Draft ${n}`, true) : null,
    mailSentPreview: n % 4 === 0 ? preview(30000, `Sent ${n}`, false) : null,
    inboxVisible: n % 2 === 0,
    isRead: n % 4 === 0,
    isSignal: n % 3 === 0,
    isImportant: n % 3 === 0,
    isDraft: false,
    snippet: `Fixture message ${n}`,
    senderEmail: 'sender@example.com',
    senderName: 'Fixture sender',
    senderPhotoUrl: null,
    latestInboundMessageTs: '2025-01-02T00:00:00Z',
    sortTs: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    viewedAt: null,
    notifications: [],
    participants: [],
    attachments: [],
    labels: [],
    properties: [],
    messages: [],
    isFavorited: false,
  };
});

export const identity = {
  userId: USER_ID,
  email: EMAIL,
  name: 'Offline Fixture',
  permissions: [],
  licenseStatus: 'Active',
  tutorialComplete: true,
  hasChromeExt: false,
  hasTrialed: true,
  aiDataConsent: true,
  referralCode: 'offline-fixture',
};
