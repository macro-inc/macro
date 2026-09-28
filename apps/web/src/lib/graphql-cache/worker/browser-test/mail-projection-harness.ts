import { createClient, gql, stringifyDocument } from '@urql/core';
import { filter, map, pipe } from 'wonka';
import { createDraftThread } from '../../../queries/email/graphql/optimistic-thread';
import {
  type CachedMailView,
  materializeMailView,
} from '../../../queries/soup/graphql/mail-view';
import { emailCacheDeletionKeys } from '../../../service-clients/service-storage/email-cache-deletions';
import {
  DeleteEmailDraftDocument,
  EmailThreadMessageFieldsFragmentDoc,
  type MailItemFieldsFragment,
  SaveEmailDraftDocument,
  type SaveEmailDraftMutation,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import { entityFromArgument } from '../../exchange/entity-resolvers';
import { normalizedCacheExchange } from '../../exchange/normalized-cache-exchange';
import { executeOptimisticMutation } from '../../exchange/optimistic';
import {
  readRecordsByKeys,
  selectRecords,
} from '../../exchange/record-selection';
import { createWorkerCacheHost } from '../../host/worker-host';
import { mailProjectionCapsules } from './mail-projection-capsules';

const scope =
  new URLSearchParams(location.search).get('scope') ??
  `offline-mail-${crypto.randomUUID()}`;
const createHost = () =>
  createWorkerCacheHost({
    scope,
    requestTimeoutMs: 30_000,
  });
const host = createHost();
const result = document.querySelector<HTMLParagraphElement>('#result')!;
const rows = document.querySelector<HTMLOListElement>('#rows')!;
const more = document.querySelector<HTMLButtonElement>('#more')!;
const select = (id: string) =>
  document.querySelector<HTMLSelectElement>(`#${id}`)!;
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const nil = id(0);
const mailOnlyFilters = {
  documentFilter: { literal: { id: nil } },
  projectFilter: { literal: { projectIdSelf: nil } },
  chatFilter: { literal: { chatId: nil } },
  calendarEventFilter: { literal: { id: nil } },
  channelFilter: { literal: { channelId: nil } },
  channelThreadFilter: { literal: { threadId: nil } },
  callFilter: { literal: { callId: nil } },
  crmCompanyFilter: { literal: { id: nil } },
  foreignEntityFilter: { literal: { id: nil } },
};
const previewFields =
  'id subject snippet isDraft senderEmail senderName senderPhotoUrl';
const previews = `mailAllPreview { ${previewFields} } mailDraftPreview { ${previewFields} } mailSentPreview { ${previewFields} }`;
const query = `query MailSeed { user { id emailLinks { id } soup(input:{initial:{limit:100,emailView:ALL}}) { items { __typename id cacheProjection ... on GraphqlSoupEmailThread { name linkId ownerId isRead inboxVisible isSignal isFavorited latestInboundMessageTs ${previews} updatedAt properties { id } } } } } }`;
const fragment = `fragment MailRow on GraphqlSoupEmailThread { __typename id emailName:name isRead inboxVisible ${previews} }`;
const preview = (n: number, subject: string, isDraft: boolean) => ({
  id: id(n),
  subject,
  snippet: subject,
  isDraft,
  senderEmail: null,
  senderName: null,
  senderPhotoUrl: null,
});
let nextCursor: string | undefined;
let requestId = 0;
async function refresh(append = false) {
  const current = ++requestId;
  more.disabled = true;
  const literals: Record<string, unknown>[] = [];
  for (const [control, field] of [
    ['signal', 'importance'],
    ['read', 'read'],
    ['archive', 'inboxVisible'],
    ['calendar', 'calendarOnly'],
  ]) {
    const value = select(control).value;
    if (value !== 'all')
      literals.push({ literal: { [field]: value === 'true' } });
  }
  if (select('account').value !== 'all')
    literals.push({ literal: { owner: id(Number(select('account').value)) } });
  if (select('sharing').value !== 'EXCLUDE')
    literals.push({ literal: { shared: select('sharing').value } });
  const tree = literals.reduce<Record<string, unknown> | undefined>(
    (left, right) => (left ? { and: { left, right } } : right),
    undefined
  );
  const filters = {
    ...mailOnlyFilters,
    ...(tree ? { emailFilter: { tree } } : {}),
  };
  try {
    const page = await host.entityFilter({
      filters,
      sortMethod: 'UPDATED_AT',
      sortDirection: 'DESC',
      limit: 10,
      mail: {
        view: select('view').value as CachedMailView,
        ...(append && nextCursor ? { cursor: nextCursor } : {}),
      },
    });
    if (current !== requestId) return;
    if (page.kind !== 'mail-page') throw new Error(JSON.stringify(page));
    const selected = await host.readRecordsByKeys({
      document: fragment,
      fragmentName: 'MailRow',
      keys: page.keys,
    });
    if (current !== requestId) return;
    if (page.revision !== selected.revision) throw new Error('stale page');
    if (!append) rows.replaceChildren();
    for (const { recordKey, record } of selected.records) {
      const email = materializeMailView(
        record as MailItemFieldsFragment,
        select('view').value as CachedMailView,
        page.sortTimestamps[page.keys.indexOf(recordKey)]
      );
      if (!email || email.__typename !== 'GraphqlSoupEmailThread')
        throw new Error('missing canonical preview');
      const li = document.createElement('li');
      li.textContent = `${email.emailName} — ${email.inboxVisible ? 'Not Done' : 'Done'}`;
      rows.append(li);
    }
    nextCursor = page.nextCursor ?? undefined;
    more.disabled = !nextCursor;
    result.dataset.status = 'ready';
    result.textContent = `${rows.children.length} cached emails shown`;
  } catch (error) {
    if (current !== requestId) return;
    result.dataset.status = 'failed';
    result.textContent = String(error);
  }
}

for (const control of document.querySelectorAll('select'))
  control.addEventListener('change', () => {
    void refresh();
  });
more.addEventListener('click', () => {
  void refresh(true);
});

const draftStatus =
  document.querySelector<HTMLParagraphElement>('#draft-status')!;
let draftVersion = 0;
document.querySelector('#create-draft')!.addEventListener('click', async () => {
  try {
    const body =
      ++draftVersion === 1 ? 'Saved on this device' : 'Latest offline edit';
    const now = new Date().toISOString();
    const draft: SaveEmailDraftMutation['saveEmailDraft']['draft'] = {
      __typename: 'GraphqlSoupEmailMessage',
      id: id(8001),
      threadId: id(8002),
      providerId: null,
      replyingToId: null,
      linkId: id(1000),
      subject: 'Offline standalone',
      snippet: 'Saved on this device',
      internalDateTs: null,
      sentAt: null,
      isRead: true,
      isStarred: false,
      isSent: false,
      isDraft: true,
      hasAttachments: false,
      scheduledSendTime: null,
      from: { email: 'sender@example.com', name: null, photoUrl: null },
      to: [{ email: 'recipient@example.com', name: null, photoUrl: null }],
      cc: [],
      bcc: [],
      labels: [],
      attachments: [],
      attachmentsDraft: [],
      attachmentsForwarded: [],
      calendarInvitations: [],
      bodyText: body,
      bodyHtmlSanitized: `<p>${body}</p>`,
      bodyMacro: null,
      bodyReplyless: null,
      createdAt: now,
      updatedAt: now,
    };
    await host.enqueueOptimisticMutation(
      {
        uuid: id(8001),
        query: stringifyDocument(SaveEmailDraftDocument),
        operationName: 'SaveEmailDraft',
        variables: {
          input: {
            draftId: id(8001),
            threadDbId: id(8002),
            subject: draft.subject,
            bodyText: draft.bodyText,
          },
        },
        data: {
          saveEmailDraft: {
            draftId: id(8001),
            draft,
            thread: createDraftThread(draft, 'offline-mail-viewer', true),
          },
        },
        identityBindings: [
          {
            localKey: `GraphqlSoupEmailMessage:${id(8001)}`,
            responsePath: ['saveEmailDraft', 'draft'],
          },
          {
            localKey: `GraphqlSoupEmailThread:${id(8002)}`,
            responsePath: ['saveEmailDraft', 'thread'],
            referenceFields: ['GraphqlSoupEmailMessage.threadId'],
          },
        ],
      },
      {
        owner: 'offline-draft-test',
        nowMs: Date.now(),
        leaseExpiresAtMs: Date.now() + 1000,
      }
    );
    draftStatus.textContent = 'Draft queued';
    await refresh();
  } catch (error) {
    draftStatus.textContent = String(error);
  }
});
document.querySelector('#reopen-draft')!.addEventListener('click', async () => {
  try {
    const reader = createHost();
    const result = await reader.readRecordsByKeys({
      document:
        'fragment SavedDraft on GraphqlSoupEmailMessage { id threadId subject bodyHtmlSanitized to { email } linkId }',
      fragmentName: 'SavedDraft',
      keys: [`GraphqlSoupEmailMessage:${id(8001)}`],
    });
    reader.dispose();
    const draft = result.records[0];
    draftStatus.textContent = JSON.stringify(draft);
    await refresh();
  } catch (error) {
    draftStatus.textContent = String(error);
  }
});

document.querySelector('#resume-draft')!.addEventListener('click', async () => {
  try {
    const readDraft = () =>
      readRecordsByKeys(
        host,
        selectRecords(EmailThreadMessageFieldsFragmentDoc),
        [`GraphqlSoupEmailMessage:${id(8001)}`]
      );
    const restored = (await readDraft()).records[0];
    if (!restored?.identity?.pending)
      throw new Error('expected a persisted pending draft');
    const draft = {
      ...restored.record,
      id: id(9001),
      threadId: id(9002),
    };
    const sentDraftIds: unknown[] = [];
    const errors: unknown[] = [];
    const client = createClient({
      url: '/scripted-email-server',
      exchanges: [
        normalizedCacheExchange(host, {
          onCacheError: (error) => errors.push(error),
        }),
        () => (operations) =>
          pipe(
            operations,
            filter((operation) => operation.kind === 'mutation'),
            map((operation) => {
              sentDraftIds.push(operation.variables?.input.draftId);
              return {
                operation,
                stale: false,
                hasNext: false,
                data: {
                  saveEmailDraft: {
                    draftId: draft.id,
                    draft: {
                      ...draft,
                      bodyText: operation.variables?.input.bodyText,
                    },
                    thread: createDraftThread(
                      draft,
                      'offline-mail-viewer',
                      true
                    ),
                  },
                },
              };
            })
          ),
      ],
    });
    // Initialize the exchange, which resumes the durable queue without a composer.
    await client
      .query(
        gql`query Viewer { user { id } }`,
        {},
        { requestPolicy: 'cache-only' }
      )
      .toPromise();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (errors.length) throw errors[0];
      const current = (await readDraft()).records[0];
      if (current && current.identity?.pending === false) {
        if (
          JSON.stringify(sentDraftIds) !== JSON.stringify([id(8001), id(8001)])
        ) {
          throw new Error(
            `unexpected replay order: ${JSON.stringify(sentDraftIds)}`
          );
        }
        if (
          current.record.id !== id(9001) ||
          current.record.threadId !== id(9002)
        ) {
          throw new Error('server identity was not recovered');
        }
        if (current.record.bodyText !== 'Latest offline edit')
          throw new Error('newer edit was lost');
        draftStatus.textContent =
          'Draft synced after reload; latest edit and server identity confirmed';
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('draft stayed pending after reconnect');
  } catch (error) {
    draftStatus.textContent = String(error);
  }
});

document
  .querySelector('#check-deletions')!
  .addEventListener('click', async () => {
    try {
      const missingThread = id(12);
      const deletedDraftThread = id(24);
      const directQuery = gql`
      query EmailThreadPage($threadId: ID!) {
        user { id emailThread(input: {threadId: $threadId}) { id name } }
      }
    `;
      const client = createClient({
        url: '/scripted-email-server',
        exchanges: [
          normalizedCacheExchange(host, {
            deletedRecordKeys: emailCacheDeletionKeys,
            entityResolvers: {
              GraphqlUser: {
                emailThread: entityFromArgument('GraphqlSoupEmailThread', [
                  'input',
                  'threadId',
                ]),
              },
            },
          }),
          () => (operations) =>
            pipe(
              operations,
              map((operation) => ({
                operation,
                stale: false,
                hasNext: false,
                data:
                  operation.kind === 'mutation'
                    ? {
                        deleteEmailDraft: {
                          draftId: id(20024),
                          deleted: true,
                          threadDeleted: true,
                          threadId: deletedDraftThread,
                          thread: null,
                        },
                      }
                    : {
                        user: { id: 'offline-mail-viewer', emailThread: null },
                      },
              }))
            ),
        ],
      });
      const before = await client
        .query(
          directQuery,
          { threadId: missingThread },
          { requestPolicy: 'cache-only' }
        )
        .toPromise();
      if (!before.data?.user.emailThread)
        throw new Error('ghost was not seeded');
      await client
        .query(
          directQuery,
          { threadId: missingThread },
          { requestPolicy: 'network-only' }
        )
        .toPromise();
      const after = await client
        .query(
          directQuery,
          { threadId: missingThread },
          { requestPolicy: 'cache-only' }
        )
        .toPromise();
      if (after.data?.user.emailThread !== null)
        throw new Error('cached entity overrode server null');
      const deleted = await executeOptimisticMutation(
        client,
        DeleteEmailDraftDocument,
        {
          input: { draftId: id(20024) },
        },
        {
          deleteEmailDraft: {
            draftId: id(20024),
            deleted: true,
            threadDeleted: false,
            threadId: deletedDraftThread,
            thread: null,
          },
        },
        { uuid: crypto.randomUUID() }
      ).toPromise();
      if (deleted.error) throw deleted.error;
      const reader = createHost();
      try {
        const records = await reader.readRecordsByKeys({
          document: fragment,
          fragmentName: 'MailRow',
          keys: [missingThread, deletedDraftThread].map(
            (value) => `GraphqlSoupEmailThread:${value}`
          ),
        });
        if (records.records.length)
          throw new Error('deleted thread remains readable');
        for (const view of ['ALL', 'DRAFTS', 'SENT'] as const) {
          const page = await reader.entityFilter({
            filters: mailOnlyFilters,
            sortMethod: 'UPDATED_AT',
            sortDirection: 'DESC',
            limit: 100,
            mail: { view },
          });
          if (page.kind !== 'mail-page') throw new Error('missing Mail page');
          if (
            page.keys.some(
              (key) =>
                key.endsWith(missingThread) || key.endsWith(deletedDraftThread)
            )
          ) {
            throw new Error(`ghost remains in ${view}`);
          }
        }
      } finally {
        reader.dispose();
      }
      await refresh();
      draftStatus.textContent =
        'Deleted threads absent from records and Mail views';
    } catch (error) {
      draftStatus.textContent = String(error);
    }
  });
await host.writeQuery({
  query,
  identity: 'offline-mail-viewer',
  data: {
    user: {
      id: 'offline-mail-viewer',
      emailLinks: [{ id: id(1000) }, { id: id(1001) }],
      soup: {
        items: Array.from({ length: 75 }, (_, index) => {
          const n = index + 1;
          return {
            __typename: 'GraphqlSoupEmailThread',
            id: id(n),
            name: `Wrong last-query preview ${n}`,
            ownerId:
              n <= 50 ? 'offline-mail-viewer' : 'macro|other@example.com',
            cacheProjection: mailProjectionCapsules[index],
            properties: [],
            isFavorited: false,
            mailAllPreview:
              n === 7 ? null : preview(n + 10000, `Email ${n}`, false),
            mailDraftPreview:
              n % 3 === 0 && n !== 7
                ? preview(n + 20000, `Draft ${n}`, true)
                : null,
            mailSentPreview:
              n % 4 === 0 && n !== 7
                ? preview(n + 30000, `Sent ${n}`, false)
                : null,
            linkId: id(n <= 50 ? 1000 : n <= 70 ? 1001 : 9999),
            isRead: n % 4 === 0,
            inboxVisible: n % 2 === 0,
            isSignal: n % 3 === 0,
            latestInboundMessageTs: n === 2 ? null : '2025-01-02T00:00:00Z',
            updatedAt: '2025-01-04T00:00:00Z',
          };
        }),
      },
    },
  },
});
await refresh();
window.addEventListener('pagehide', () => host.dispose(), { once: true });
