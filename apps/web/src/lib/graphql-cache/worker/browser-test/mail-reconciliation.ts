import { createWorkerCacheHost } from '../../host/worker-host';
import { mailProjectionCapsules } from './mail-projection-capsules';

const parameters = new URLSearchParams(location.search);
const host = createWorkerCacheHost({
  scope: parameters.get('scope') ?? `mail-reconcile-${crypto.randomUUID()}`,
  requestTimeoutMs: 30_000,
});
const VIEWER = 'offline-mail-viewer';
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const NIL = id(0);
const FILTERS = {
  documentFilter: { literal: { id: NIL } },
  projectFilter: { literal: { projectIdSelf: NIL } },
  chatFilter: { literal: { chatId: NIL } },
  calendarEventFilter: { literal: { id: NIL } },
  channelFilter: { literal: { channelId: NIL } },
  channelThreadFilter: { literal: { threadId: NIL } },
  callFilter: { literal: { callId: NIL } },
  crmCompanyFilter: { literal: { id: NIL } },
  foreignEntityFilter: { literal: { id: NIL } },
  emailFilter: { tree: { literal: { importance: false } } },
};
const QUERY = `query Soup($input: SoupInput!) {
  user {
    id emailLinks { id }
    soup(input: $input) {
      nextCursor
      items {
        __typename id cacheProjection isFavorited
        ... on GraphqlSoupEmailThread {
          linkId ownerId inboxVisible isRead isSignal updatedAt
          latestInboundMessageTs reminderReturnedAt properties { id }
          mailAllPreview { id } mailDraftPreview { id } mailSentPreview { id }
        }
      }
    }
  }
}`;
const VARIABLES = {
  input: {
    initial: {
      filters: FILTERS,
      emailView: 'INBOX',
      sortMethod: 'UPDATED_AT',
      sortDirection: 'DESC',
      limit: 3,
    },
  },
};
const data = (ids: number[]) => ({
  user: {
    id: VIEWER,
    emailLinks: [{ id: id(1000) }],
    soup: {
      nextCursor: 'server-continuation',
      items: ids.map((n) => ({
        __typename: 'GraphqlSoupEmailThread',
        id: id(n),
        linkId: id(1000),
        ownerId: VIEWER,
        inboxVisible: true,
        isRead: false,
        isSignal: false,
        updatedAt: '2025-01-04T00:00:00Z',
        latestInboundMessageTs: '2025-01-02T00:00:00Z',
        reminderReturnedAt: null,
        cacheProjection: mailProjectionCapsules[n - 1],
        isFavorited: false,
        properties: [],
        mailAllPreview: { id: id(n + 10000) },
        mailDraftPreview: { id: id(n + 20000) },
        mailSentPreview: null,
      })),
    },
  },
});
const result = document.querySelector<HTMLParagraphElement>('#result')!;
const rows = document.querySelector<HTMLOListElement>('#rows')!;
async function show(view: 'INBOX' | 'DRAFTS') {
  const page = await host.entityFilter({
    filters: FILTERS,
    sortMethod: 'UPDATED_AT',
    sortDirection: 'DESC',
    limit: 100,
    mail: { view },
  });
  if (page.kind !== 'mail-page') throw new Error(JSON.stringify(page));
  rows.replaceChildren(
    ...page.keys.map((key) => {
      const row = document.createElement('li');
      row.textContent = key;
      return row;
    })
  );
  result.textContent = view;
}
const failed = (error: unknown) => {
  result.textContent = String(error);
};
document.querySelector('#noise')!.addEventListener('click', async () => {
  try {
    await show('INBOX');
  } catch (error) {
    failed(error);
  }
});
document.querySelector('#drafts')!.addEventListener('click', async () => {
  try {
    await show('DRAFTS');
  } catch (error) {
    failed(error);
  }
});
document.querySelector('#network')!.addEventListener('click', async () => {
  try {
    await host.writeQuery({
      query: QUERY,
      operationName: 'Soup',
      variables: VARIABLES,
      data: data([20, 16, 8]),
      identity: VIEWER,
    });
    await show('INBOX');
  } catch (error) {
    failed(error);
  }
});
if (parameters.get('seed') !== 'false') {
  await host.writeQuery({
    query: QUERY.replace('query Soup(', 'query SoupMailBackfill('),
    operationName: 'SoupMailBackfill',
    variables: VARIABLES,
    data: data([20, 18, 16, 14, 10, 8, 6, 4]),
    identity: VIEWER,
  });
}
await show('INBOX');
window.addEventListener('pagehide', () => host.dispose(), { once: true });
