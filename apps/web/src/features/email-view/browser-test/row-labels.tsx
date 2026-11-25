// The real Mail row with labels people made, named from a seeded label list,
// as EmailList mounts it; no network.
import '@app/index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ItemDndProvider } from '@components/app/ItemDragAndDrop';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  EntityProvider,
  isEmailEntity,
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
} from '@entity';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { mapEmailFocus } from '@queries/email/focus';
import { emailKeys } from '@queries/email/keys';
import type { EmailFocusQuery } from '@service-storage/graphql/generated/graphql';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { createEmailRowLabels } from '../primitives/create-email-row-labels';

const VIEWER_ID = 'macro|row-labels@example.test';
const INBOX = 'inbox';

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: VIEWER_ID,
  email: 'row-labels@example.test',
  authenticated: true,
});

type CarriedLabel = Thread['labels'][number];

const label = (
  id: string,
  name: string,
  overrides: Partial<CarriedLabel> = {}
): CarriedLabel => ({
  __typename: 'GraphqlSoupEmailLabel',
  id,
  linkId: INBOX,
  providerLabelId: id,
  name,
  createdAt: '2026-11-01T00:00:00Z',
  messageListVisibility: 'Show',
  labelListVisibility: 'LabelShow',
  type: 'User',
  ...overrides,
});

const CUSTOMERS = label('customers', 'Customers');
const LARKSPUR = label('larkspur', 'Customers/Larkspur');
const ORDERS = label('orders', 'Orders');
const ESCALATIONS = label('escalations', 'Escalations');
const BILLING = label('billing', 'Billing');
const RECEIPTS = label('receipts', 'Receipts', {
  messageListVisibility: 'Hide',
});
const INBOX_LABEL = label('inbox-label', 'INBOX', { type: 'System' });

// The viewer's label list, as `GET /email/labels` answers it.
queryClient.setQueryData(emailKeys.userLabels(VIEWER_ID).queryKey, {
  labels: [
    CUSTOMERS,
    LARKSPUR,
    ORDERS,
    ESCALATIONS,
    BILLING,
    RECEIPTS,
    INBOX_LABEL,
  ],
});

document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme('Macro Dark');

type Thread = Extract<
  EmailFocusQuery['user']['emailFocus'][number],
  { __typename: 'GraphqlSoupEmailThread' }
>;

function thread(id: string, subject: string, labels: CarriedLabel[]): Thread {
  return {
    __typename: 'GraphqlSoupEmailThread',
    id,
    entityType: 'EMAIL_THREAD',
    providerId: null,
    ownerId: VIEWER_ID,
    inboxVisible: true,
    hasReceivedMail: true,
    linkId: INBOX,
    latestInboundMessageTs: '2026-11-03T15:00:00Z',
    latestOutboundMessageTs: null,
    latestNonSpamMessageTs: '2026-11-03T15:00:00Z',
    reminderReturnedAt: null,
    snippet: 'The carrier moved delivery to Friday.',
    senderEmail: `${id}@example.test`,
    senderName: 'Avery Stone',
    senderPhotoUrl: null,
    isRead: true,
    isDraft: false,
    isImportant: true,
    isSignal: true,
    projectId: null,
    createdAt: '2026-11-03T15:00:00Z',
    updatedAt: '2026-11-03T15:00:00Z',
    viewedAt: null,
    cacheProjection: null,
    frecencyScore: null,
    displayName: subject,
    isFavorited: false,
    emailName: subject,
    participants: [
      {
        contactId: `${id}-contact`,
        linkId: INBOX,
        name: 'Avery Stone',
        email: `${id}@example.test`,
        sfsPhotoUrl: null,
      },
    ],
    attachments: [],
    labels,
    properties: [],
    notifications: [],
    mailDraftState: null,
    mailAllPreview: null,
    mailDraftPreview: null,
    mailSentPreview: null,
    focus: {
      category: 'OTHER',
      importance: 50,
      needsReply: false,
      needsFollowUp: false,
      importanceTrend: 'FLAT',
      dueOn: null,
    },
  };
}

const ROWS = mapEmailFocus({
  user: {
    id: VIEWER_ID,
    emailFocus: [
      thread('two', 'Shipping delay on order 5518', [
        INBOX_LABEL,
        LARKSPUR,
        ORDERS,
      ]),
      thread('four', 'Refund for order 5519', [
        ORDERS,
        ESCALATIONS,
        BILLING,
        CUSTOMERS,
      ]),
      thread('hidden', 'Your receipt', [INBOX_LABEL, RECEIPTS]),
    ],
  },
});

function Fixture() {
  const [list, setList] = createSignal<HTMLElement>();
  const rowLabels = createEmailRowLabels();
  return (
    <main class="flex h-dvh flex-col bg-panel text-ink">
      <div ref={setList} class="soup-list min-h-0 flex-1 overflow-y-auto">
        <ListLayoutProvider ref={list} narrowLayout="inbox">
          <SwipableRowProvider container={list}>
            <For each={ROWS}>
              {(entity, index) => (
                <div data-testid={`row-${entity.id}`} role="row">
                  <div role="gridcell">
                    <ListEntity
                      entity={entity}
                      isFirstInGroup={index() === 0}
                      labels={
                        isEmailEntity(entity) ? rowLabels(entity) : undefined
                      }
                    />
                  </div>
                </div>
              )}
            </For>
          </SwipableRowProvider>
        </ListLayoutProvider>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <EntityProvider>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <UserContextProvider>
            <EmailLinksContextProvider>
              <ItemDndProvider>
                <ListEntityMetadataQueryProvider>
                  <Fixture />
                </ListEntityMetadataQueryProvider>
              </ItemDndProvider>
            </EmailLinksContextProvider>
          </UserContextProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </EntityProvider>
  ),
  root
);
