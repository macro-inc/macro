import type {
  EmailDraftAggregateFieldsFragment,
  SaveEmailDraftMutation,
} from '@service-storage/graphql/generated/graphql';

export type DraftThread = SaveEmailDraftMutation['saveEmailDraft']['thread'];
type Aggregate = EmailDraftAggregateFieldsFragment;
type DraftState = NonNullable<DraftThread['mailDraftState']>;
type DraftMessage = SaveEmailDraftMutation['saveEmailDraft']['draft'];

/** The typename keys the preview as its own normalized record. */
function draftPreview(draft: DraftMessage): NonNullable<
  DraftThread['mailDraftPreview']
> & {
  __typename: 'GraphqlMailPreviewMessage';
} {
  return {
    __typename: 'GraphqlMailPreviewMessage',
    id: draft.id,
    subject: draft.subject,
    snippet: draft.snippet,
    isDraft: true,
    senderEmail: draft.from?.email ?? null,
    senderName: draft.from?.name ?? null,
    senderPhotoUrl: draft.from?.photoUrl ?? null,
  };
}

/** What one local draft contributes to its thread's aggregated Mail state. */
function draftAggregateEntry(
  draft: DraftMessage,
  isSignal: boolean
): DraftState['drafts'][number] {
  return {
    id: draft.id,
    macroDraft: true,
    facts: {
      ...emptyAggregate(),
      messageCount: 1,
      inboxVisible: true,
      isSignal,
      latestInboundMessageTs: draft.updatedAt,
      latestNonSpamMessageTs: draft.updatedAt,
      preview: draftPreview(draft),
      previewTs: draft.internalDateTs ?? draft.createdAt,
    },
  };
}

/** Complete local thread, checked against both Soup and thread-page selections. */
export function createDraftThread(
  draft: DraftMessage,
  ownerId: string,
  isSignal: boolean
): DraftThread {
  const preview = draftPreview(draft);
  return {
    __typename: 'GraphqlSoupEmailThread',
    id: draft.threadId,
    entityType: 'EMAIL_THREAD',
    ownerId,
    linkId: draft.linkId,
    providerId: null,
    cacheProjection: null,
    displayName: draft.subject,
    emailName: draft.subject,
    snippet: draft.snippet,
    senderEmail: preview.senderEmail,
    senderName: preview.senderName,
    senderPhotoUrl: preview.senderPhotoUrl,
    inboxVisible: true,
    isRead: true,
    isDraft: true,
    isSignal,
    isImportant: isSignal,
    isFavorited: false,
    projectId: null,
    sortTs: draft.updatedAt,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    latestInboundMessageTs: draft.updatedAt,
    viewedAt: null,
    frecencyScore: null,
    mailAllPreview: preview,
    mailDraftPreview: preview,
    mailSentPreview: null,
    participants: [],
    attachments: [],
    labels: [],
    properties: [],
    notifications: [],
    viewerPermission: {
      __typename: 'GraphqlAccessLevelPermission',
      accessLevel: 'OWNER',
    },
    mailDraftState: {
      baseline: emptyAggregate(),
      drafts: [draftAggregateEntry(draft, isSignal)],
    },
    messages: [draft],
  };
}

function emptyAggregate(): Aggregate {
  return {
    messageCount: 0,
    inboxVisible: false,
    isRead: true,
    isSignal: false,
    hasCalendarAttachment: false,
    latestInboundMessageTs: null,
    latestNonSpamMessageTs: null,
    latestOutboundMessageTs: null,
    preview: null,
    previewTs: null,
  };
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Server preview ordering is creation/internal time, then message ID. */
function mergeAggregate(a: Aggregate, b: Aggregate): Aggregate {
  const bIsLater =
    b.preview !== null &&
    (a.preview === null ||
      Date.parse(b.previewTs!) > Date.parse(a.previewTs!) ||
      (Date.parse(b.previewTs!) === Date.parse(a.previewTs!) &&
        b.preview.id > a.preview.id));
  return {
    messageCount: a.messageCount + b.messageCount,
    inboxVisible: a.inboxVisible || b.inboxVisible,
    isRead: a.isRead && b.isRead,
    isSignal: a.isSignal || b.isSignal,
    hasCalendarAttachment: a.hasCalendarAttachment || b.hasCalendarAttachment,
    latestInboundMessageTs: latest(
      a.latestInboundMessageTs,
      b.latestInboundMessageTs
    ),
    latestNonSpamMessageTs: latest(
      a.latestNonSpamMessageTs,
      b.latestNonSpamMessageTs
    ),
    latestOutboundMessageTs: latest(
      a.latestOutboundMessageTs,
      b.latestOutboundMessageTs
    ),
    preview: bIsLater ? b.preview : a.preview,
    previewTs: bIsLater ? b.previewTs : a.previewTs,
  };
}

function applyDraftState(
  existing: DraftThread,
  state: DraftState,
  updatedAt: string
): DraftThread {
  const drafts = state.drafts.reduce(
    (sum, entry) => mergeAggregate(sum, entry.facts),
    emptyAggregate()
  );
  const all = mergeAggregate(state.baseline, drafts);
  // Read/unread mutations can update the canonical thread before the message
  // aggregate is refreshed. Preserve that newer intent across draft edits;
  // otherwise deleting the sole unread draft still recomputes the read state.
  const previousState = existing.mailDraftState;
  const previousIsRead =
    previousState &&
    previousState.baseline.isRead &&
    previousState.drafts.every((entry) => entry.facts.isRead);
  const hasNewerReadIntent =
    previousState !== null && existing.isRead !== previousIsRead;
  return {
    ...existing,
    mailDraftState: state,
    updatedAt,
    sortTs: all.latestNonSpamMessageTs ?? updatedAt,
    latestInboundMessageTs: all.latestInboundMessageTs,
    inboxVisible: all.inboxVisible,
    isDraft: drafts.preview !== null,
    isRead: hasNewerReadIntent ? existing.isRead : all.isRead,
    isSignal: all.isSignal,
    isImportant: all.isSignal,
    displayName: all.preview?.subject ?? null,
    emailName: all.preview?.subject ?? null,
    snippet: all.preview?.snippet ?? null,
    senderEmail: all.preview?.senderEmail ?? null,
    senderName: all.preview?.senderName ?? null,
    senderPhotoUrl: all.preview?.senderPhotoUrl ?? null,
    mailAllPreview: all.preview,
    mailDraftPreview: drafts.preview,
  };
}

/** Preserve conversation state while replacing only this draft's contribution. */
export function updateDraftThread(
  existing: DraftThread,
  draft: DraftMessage,
  isSignal: boolean
): DraftThread {
  // Older cache entries may lack the complete baseline. Preserve their facts;
  // never infer the unseen message history from a paginated message list.
  if (!existing.mailDraftState)
    return {
      ...existing,
      messages: [
        draft,
        ...existing.messages.filter((message) => message.id !== draft.id),
      ],
    };
  const previous = existing.mailDraftState.drafts.find(
    (entry) => entry.id === draft.id
  );
  const fresh = draftAggregateEntry(draft, isSignal);
  const entry = previous
    ? {
        ...previous,
        facts: {
          ...previous.facts,
          isRead: true,
          isSignal: previous.facts.preview ? isSignal : false,
          latestInboundMessageTs: previous.macroDraft
            ? draft.updatedAt
            : previous.facts.latestInboundMessageTs,
          latestNonSpamMessageTs: previous.macroDraft
            ? draft.updatedAt
            : previous.facts.latestNonSpamMessageTs,
          preview: previous.facts.preview ? fresh.facts.preview : null,
        },
      }
    : fresh;
  const next = applyDraftState(
    existing,
    {
      ...existing.mailDraftState,
      drafts: [
        ...existing.mailDraftState.drafts.filter(
          (entry) => entry.id !== draft.id
        ),
        entry,
      ],
    },
    draft.updatedAt
  );
  return {
    ...next,
    messages: [
      draft,
      ...existing.messages.filter((message) => message.id !== draft.id),
    ],
  };
}

/** Discard restores the full non-draft baseline, even beyond message page one. */
export function removeDraftFromThread(
  existing: DraftThread,
  draftId: string
): DraftThread | undefined {
  if (!existing.mailDraftState) return;
  const next = applyDraftState(
    existing,
    {
      ...existing.mailDraftState,
      drafts: existing.mailDraftState.drafts.filter(
        (entry) => entry.id !== draftId
      ),
    },
    new Date().toISOString()
  );
  return {
    ...next,
    messages: existing.messages.filter((message) => message.id !== draftId),
  };
}

export function draftThreadIsEmpty(thread: DraftThread): boolean {
  const state = thread.mailDraftState;
  return (
    !!state && state.baseline.messageCount === 0 && state.drafts.length === 0
  );
}
