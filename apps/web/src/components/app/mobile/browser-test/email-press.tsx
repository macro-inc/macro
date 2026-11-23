// Mail's phone list as EmailList mounts it: the real email rows in the real
// virtualizer, each inside the real long-press context menu, with the real
// action drawer and the app's row press installed; no network.
import '@fontsource-variable/inter';
import '../../../../index.css';
// The row layouts sit on an import cycle that the app enters through
// @entity; enter it the same way.
import '@entity';
import '@entity/composed/ListEntity.css';
import { StickyVirtualizer } from '@app/components/list/StickyVirtualizer';
import {
  type EntityActionViewContext,
  toSingleEntityActionListState,
} from '@app/features/next-soup/actions';
import { SoupEntityActionDrawer } from '@app/features/soup/SoupEntityActionDrawer';
import {
  type EntityActionDrawerEntry,
  SoupEntityActionDrawerContextProvider,
} from '@app/features/soup/SoupEntityActionDrawerContext';
import { SoupEntityContextMenu } from '@app/features/soup/SoupEntityContextMenu';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ItemDndProvider } from '@components/app/ItemDragAndDrop';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type EntityData,
  EntityProvider,
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
} from '@entity';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { mapEmailFocus } from '@queries/email/focus';
import type { EmailFocusQuery } from '@service-storage/graphql/generated/graphql';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../../features/theme/themes/macro-light';
import { holdRowPress, installRowPress } from '../rowPress';
import { SwipableRowProvider } from '../SwipableRow';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';
document.documentElement.dataset.touchDevice = String(isTouchDevice());

const VIEWER_ID = 'macro|viewer@example.test';
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: VIEWER_ID,
  email: 'viewer@example.test',
  authenticated: true,
});

type Thread = Extract<
  EmailFocusQuery['user']['emailFocus'][number],
  { __typename: 'GraphqlSoupEmailThread' }
>;

function thread(index: number): Thread {
  const id = `mail-${index}`;
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
    snippet: `Preview ${index}, with enough text to run past the end of the row.`,
    senderEmail: `${id}@example.test`,
    senderName: `Sender ${index}`,
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
    displayName: `Subject ${index}`,
    isFavorited: false,
    emailName: `Subject ${index}`,
    participants: [
      {
        contactId: `${id}-contact`,
        linkId: 'inbox',
        name: `Sender ${index}`,
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
      importanceTrend: 'FLAT',
      dueOn: null,
    },
  };
}

const ROWS: EntityData[] = mapEmailFocus({
  user: {
    id: VIEWER_ID,
    emailFocus: Array.from({ length: 12 }, (_, index) => thread(index)),
  },
});

const VIEW_CONTEXT: EntityActionViewContext = {
  supportsMarkDone: true,
  supportsOpenInNewSplit: false,
  senderBucket: 'signal',
};

function Fixture() {
  const [viewport, setViewport] = createSignal<HTMLElement>();
  const [opened, setOpened] = createSignal('');
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [entry, setEntry] = createSignal<EntityActionDrawerEntry>();
  onCleanup(installRowPress());

  const drawer = {
    isOpen: drawerOpen,
    entry,
    open: (next: EntityActionDrawerEntry) => {
      setEntry(() => next);
      setDrawerOpen(true);
    },
    close: () => setDrawerOpen(false),
  };

  return (
    <SoupEntityActionDrawerContextProvider value={drawer}>
      <main
        class="flex h-dvh flex-col bg-panel text-ink"
        data-opened={opened()}
      >
        <div
          ref={setViewport}
          class="soup-list min-h-0 flex-1 overflow-y-auto overscroll-none"
        >
          <ListLayoutProvider ref={viewport} narrowLayout="inbox">
            <SwipableRowProvider container={viewport}>
              <StickyVirtualizer
                data={ROWS}
                scrollRef={viewport()}
                bufferSize={500}
                itemSize={44}
              >
                {(entity) => (
                  <SoupEntityContextMenu
                    entity={entity}
                    list={toSingleEntityActionListState(() => entity)}
                    selectedEntities={() => []}
                    viewContext={VIEW_CONTEXT}
                  >
                    <div id={entity.id} role="row" data-soup-entity>
                      <div role="gridcell">
                        <ListEntity
                          entity={entity}
                          entityRowConfig={{
                            swipeLeftColor: 'bg-success',
                            swipeRightColor: 'bg-accent',
                          }}
                          onClick={(event) => {
                            // Mail's open holds the press until it settles.
                            const release = holdRowPress(event);
                            setOpened(entity.id);
                            window.setTimeout(() => release?.(), 600);
                          }}
                        />
                      </div>
                    </div>
                  </SoupEntityContextMenu>
                )}
              </StickyVirtualizer>
            </SwipableRowProvider>
          </ListLayoutProvider>
        </div>
      </main>
      <SoupEntityActionDrawer
        entity={entry()?.entity}
        groups={[
          {
            items: [
              { id: 'archive', label: 'Archive', onClick: () => {} },
              { id: 'done', label: 'Mark done', onClick: () => {} },
            ],
          },
        ]}
        open={drawerOpen()}
        onOpenChange={(open) => {
          if (!open) drawer.close();
        }}
      />
    </SoupEntityActionDrawerContextProvider>
  );
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ItemDndProvider>
                  <ListEntityMetadataQueryProvider>
                    <MemoryRouter>
                      <Route path="*" component={Fixture} />
                    </MemoryRouter>
                  </ListEntityMetadataQueryProvider>
                </ItemDndProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root') as HTMLElement
);
