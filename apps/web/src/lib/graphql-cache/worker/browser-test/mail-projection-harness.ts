import {
  type CachedMailView,
  materializeMailView,
} from '../../../queries/soup/graphql/mail-view';
import type { MailItemFieldsFragment } from '../../../service-clients/service-storage/graphql/generated/graphql';
import { createWorkerCacheHost } from '../../host/worker-host';
import { mailProjectionCapsules } from './mail-projection-capsules';

const host = createWorkerCacheHost({
  scope: `offline-mail-${crypto.randomUUID()}`,
  requestTimeoutMs: 30_000,
});
const result = document.querySelector<HTMLParagraphElement>('#result')!;
const rows = document.querySelector<HTMLOListElement>('#rows')!;
const more = document.querySelector<HTMLButtonElement>('#more')!;
const select = (id: string) =>
  document.querySelector<HTMLSelectElement>(`#${id}`)!;
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const nil = id(0);
const previewFields =
  'id subject snippet isDraft senderEmail senderName senderPhotoUrl';
const previews = `mailAllPreview { ${previewFields} } mailDraftPreview { ${previewFields} } mailSentPreview { ${previewFields} }`;
const query = `query MailSeed { user { id emailLinks { id } soup(input:{initial:{limit:100,emailView:ALL}}) { items { __typename id cacheProjection ... on GraphqlSoupEmailThread { name linkId ownerId isRead inboxVisible isSignal latestInboundMessageTs ${previews} updatedAt } } } } }`;
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
    documentFilter: { literal: { id: nil } },
    projectFilter: { literal: { projectIdSelf: nil } },
    chatFilter: { literal: { chatId: nil } },
    calendarEventFilter: { literal: { id: nil } },
    channelFilter: { literal: { channelId: nil } },
    channelThreadFilter: { literal: { threadId: nil } },
    callFilter: { literal: { callId: nil } },
    crmCompanyFilter: { literal: { id: nil } },
    foreignEntityFilter: { literal: { id: nil } },
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
