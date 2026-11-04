// The real row, slots and Focus mapping over synthetic threads; no network.
import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ItemDndProvider } from '@components/app/ItemDragAndDrop';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  EntityProvider,
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
} from '@entity';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { mapEmailFocus } from '@queries/email/focus';
import type { EmailFocusQuery } from '@service-storage/graphql/generated/graphql';
import { createSignal, For, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import {
  EMAIL_FOCUS_WIDE_BREAKPOINT,
  EmailFocusPreviewLeading,
  EmailFocusReason,
  EmailFocusScore,
} from '../components/EmailFocusBadges';
import type { EmailFocusSort } from '../constants';

const VIEWER_ID = 'macro|focus-rows@example.test';

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: VIEWER_ID,
  email: 'focus-rows@example.test',
  authenticated: true,
});

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const search = new URLSearchParams(window.location.search);
const dark = search.get('theme') !== 'light';
document.documentElement.dataset.themeLight = String(!dark);
const theme = dark ? macroDarkTheme : macroLightTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

type Thread = Extract<
  EmailFocusQuery['user']['emailFocus'][number],
  { __typename: 'GraphqlSoupEmailThread' }
>;
type Focus = NonNullable<Thread['focus']>;

function thread(
  id: string,
  sender: string,
  subject: string,
  focus: Partial<Focus>
): Thread {
  return {
    __typename: 'GraphqlSoupEmailThread',
    id,
    entityType: 'EMAIL_THREAD',
    providerId: null,
    ownerId: VIEWER_ID,
    inboxVisible: true,
    hasReceivedMail: true,
    linkId: 'inbox',
    latestInboundMessageTs: '2026-11-03T15:00:00Z',
    latestOutboundMessageTs: null,
    latestNonSpamMessageTs: '2026-11-03T15:00:00Z',
    reminderReturnedAt: null,
    snippet:
      'Here is the latest on this, with enough preview text to run past the end of any row.',
    senderEmail: `${id}@example.test`,
    senderName: sender,
    senderPhotoUrl: null,
    isRead: false,
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
        linkId: 'inbox',
        name: sender,
        email: `${id}@example.test`,
        sfsPhotoUrl: null,
      },
    ],
    attachments: [],
    labels: [],
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
      ...focus,
    },
  };
}

const LONG_SUBJECT =
  'A subject long enough that it has to truncate somewhere on every row width we support';

const ROWS = mapEmailFocus({
  user: {
    id: VIEWER_ID,
    emailFocus: [
      thread('reply', 'Avery Stone', LONG_SUBJECT, {
        category: 'CUSTOMER',
        importance: 92,
        needsReply: true,
      }),
      thread('follow-up', 'Blair Quinn', LONG_SUBJECT, {
        category: 'TEAM',
        importance: 71,
        needsFollowUp: true,
      }),
      thread('both', 'Casey Moore', 'Written before the flags were exclusive', {
        category: 'KNOWN',
        importance: 64,
        needsReply: true,
        needsFollowUp: true,
      }),
      thread('calendar', 'Drew Park', 'Moved to Thursday at 3', {
        category: 'CALENDAR',
        importance: 55,
      }),
      thread('customer', 'Emery Lane', 'Question about our invoice', {
        category: 'CUSTOMER',
        importance: 44,
      }),
      thread('team', 'Finley Ross', 'Notes from the review', {
        category: 'TEAM',
        importance: 33,
      }),
      thread('contact', 'Gray Ellis', 'Good to see you last week', {
        category: 'KNOWN',
        importance: 22,
      }),
      thread('other', 'Harper Vale', LONG_SUBJECT, {
        category: 'OTHER',
        importance: 8,
      }),
      // The server ships separately, so it can send what this build doesn't know.
      thread('unknown', 'Indigo Hart', 'From a newer server', {
        category: JSON.parse('"NEWLY_ADDED"'),
        importance: 2,
      }),
    ],
  },
});

function Fixture() {
  const [sort, setSort] = createSignal<EmailFocusSort>('priority');
  const [list, setList] = createSignal<HTMLElement>();
  const sortButton = (value: EmailFocusSort, label: string): JSX.Element => (
    <button
      type="button"
      aria-pressed={sort() === value}
      onClick={() => setSort(value)}
    >
      {label}
    </button>
  );
  return (
    <main class="flex h-dvh flex-col bg-panel text-ink">
      <div class="flex h-8 shrink-0 gap-2 px-2 text-xs text-ink-muted">
        {sortButton('priority', 'Priority')}
        {sortButton('importance', 'Importance')}
      </div>
      <div ref={setList} class="soup-list min-h-0 flex-1 overflow-y-auto">
        <ListLayoutProvider
          ref={list}
          narrowLayout="inbox"
          wideBreakpoint={EMAIL_FOCUS_WIDE_BREAKPOINT}
        >
          <SwipableRowProvider container={list}>
            <For each={ROWS}>
              {(entity) => (
                <div data-testid={`row-${entity.id}`}>
                  {/* Mounted as EmailList mounts them. */}
                  <ListEntity
                    entity={entity}
                    meta={<EmailFocusReason entity={entity} />}
                    metaEnd={<EmailFocusScore entity={entity} sort={sort()} />}
                    previewLeading={
                      <EmailFocusPreviewLeading entity={entity} sort={sort()} />
                    }
                  />
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
