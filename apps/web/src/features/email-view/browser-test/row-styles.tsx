// The real Mail row in each row style over synthetic threads; no network.
// `?style=classic` picks the style, `?theme=light` the light theme, and
// `?view=settings` shows Settings → Email's Display options instead.
import '@app/index.css';
import { EmailDisplayOptions } from '@app/features/settings/email-settings';
import { SettingsSection } from '@app/features/settings/primitives';
import { createSoupGroupHeaderRow } from '@app/features/soup/collection/rows';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
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
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { EmailDateGroupHeader } from '../components/EmailDateGroupHeader';
import {
  parseEmailRowStyle,
  rowStyleForDevice,
  setEmailRowStyle,
} from '../primitives/email-row-style';

const VIEWER_ID = 'macro|row-styles@example.test';

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: VIEWER_ID,
  email: 'row-styles@example.test',
  authenticated: true,
});

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const search = new URLSearchParams(window.location.search);
applyTheme(search.get('theme') === 'light' ? 'Macro Light' : 'Macro Dark');
const chosenStyle = parseEmailRowStyle(search.get('style'));
const showsSettings = search.get('view') === 'settings';
if (showsSettings) setEmailRowStyle(chosenStyle);

type Thread = Extract<
  EmailFocusQuery['user']['emailFocus'][number],
  { __typename: 'GraphqlSoupEmailThread' }
>;

function thread(
  id: string,
  sender: string,
  subject: string,
  isRead: boolean
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
    isRead,
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
    // Focus rows map like any other; the fixture shows none of the focus pills.
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
      thread('unread-1', 'Avery Stone', 'Contract redlines for Friday', false),
      thread('unread-2', 'Blair Quinn', 'Can we move the review?', false),
      thread('read-1', 'Casey Moore', 'Notes from the offsite', true),
      thread('unread-3', 'Drew Park', 'Invoice 4471 is ready', false),
      thread('read-2', 'Emery Lane', 'Re: hiring plan', true),
      thread('read-3', 'Finley Ross', 'Lunch next week?', true),
      thread('unread-4', 'Gray Ellis', 'Launch checklist', false),
      thread('read-4', 'Harper Vale', 'Weekly digest', true),
    ],
  },
});

// Two date groups, as Mail lists them: one opens on unread mail, one on read.
const GROUPS = [
  { id: 'today', label: 'Today', rows: ROWS.slice(0, 4) },
  { id: 'yesterday', label: 'Yesterday', rows: ROWS.slice(4) },
].map((group, index) => ({
  header: createSoupGroupHeaderRow(group),
  isFirst: index === 0,
  rows: group.rows,
}));

function Fixture() {
  const [list, setList] = createSignal<HTMLElement>();
  const [selected, setSelected] = createSignal<string[]>([]);
  const [highlighted, setHighlighted] = createSignal<string>();
  const [opened, setOpened] = createSignal<string>();
  const toggle = (id: string, checked: boolean) =>
    setSelected((ids) =>
      checked ? [...ids, id] : ids.filter((selectedId) => selectedId !== id)
    );

  return (
    <main
      class="flex h-dvh flex-col bg-panel text-ink"
      data-opened={opened() ?? ''}
    >
      <div ref={setList} class="soup-list min-h-0 flex-1 overflow-y-auto">
        <ListLayoutProvider ref={list} narrowLayout="inbox">
          <SwipableRowProvider container={list}>
            <For each={GROUPS}>
              {(group) => (
                <>
                  <EmailDateGroupHeader
                    row={group.header}
                    isFirst={group.isFirst}
                  />
                  <For each={group.rows}>
                    {(entity, index) => (
                      <div data-testid={`row-${entity.id}`} role="row">
                        {/* Mounted as EmailList mounts them. */}
                        <div role="gridcell">
                          <ListEntity
                            entity={entity}
                            rowStyle={rowStyleForDevice(chosenStyle)}
                            isFirstInGroup={index() === 0}
                            checked={selected().includes(entity.id)}
                            highlighted={
                              !isTouchDevice() && highlighted() === entity.id
                            }
                            onMouseMove={() => setHighlighted(entity.id)}
                            onChecked={(checked) => toggle(entity.id, checked)}
                            onClick={() => setOpened(entity.id)}
                          />
                        </div>
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>
          </SwipableRowProvider>
        </ListLayoutProvider>
      </div>
    </main>
  );
}

function SettingsFixture() {
  return (
    <main class="@container h-dvh bg-panel p-6 text-ink">
      <div class="mx-auto max-w-2xl">
        <SettingsSection
          title={t('settingsEmail.displayOptions')}
          description={t('settingsEmail.displayOptionsDescription')}
        >
          <EmailDisplayOptions />
        </SettingsSection>
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
                  <Show when={showsSettings} fallback={<Fixture />}>
                    <SettingsFixture />
                  </Show>
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
