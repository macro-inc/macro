// Touch Notifications' Signal rows as HomeList wires them: InboxListEntity in
// swipe rows keyed by occurrence, over an in-memory list, marked done through
// the real mark-done action and list adapter, with a delegate that completes
// rows the way the work feed does: it hides them at once, except own work,
// which stays.
import '@app/index.css';
import type { ListController } from '@app/components/list';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { macroLightTheme } from '@app/features/theme/themes/macro-light';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { SwipableRowProvider } from '@components/app/mobile/SwipableRow';
import { ChannelDirectoryProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type EntityData,
  EntityProvider,
  type WithNotification,
} from '@entity';
import type { NotificationSource } from '@notifications';
import { authKeys } from '@queries/auth/keys';
import { staticChannelDirectory } from '@queries/channel/directory';
import { queryClient } from '@queries/client';
import { MutationUndoProvider } from '@queries/undo';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { toEntityActionListState } from '../../../../actions/entity-action-context';
import { makeMarkDoneAction } from '../../../../actions/make-mark-done-action';
import type { MarkDoneDelegate } from '../../../../actions/mark-done-delegate';
import { InboxListEntity } from '../InboxListEntity';

declare global {
  interface Window {
    /** Each row the delegate completed, in order. */
    __signalDone: string[];
  }
}
window.__signalDone = [];

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'macro|viewer@example.test',
  email: 'viewer@example.test',
  authenticated: true,
});

document.documentElement.dataset.touchDevice = 'true';
document.documentElement.dataset.themeLight = 'true';
for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

// `?keep=<id>`: the delegate leaves that row in the list, as the work feed
// leaves the viewer's own work in place.
const KEPT = new URLSearchParams(location.search).get('keep');
const NAMES = ['Plan', 'Notes', 'Budget', 'Roadmap', 'Retro', 'Launch'];
const NOW = Date.now();

const doc = (name: string, index: number) =>
  ({
    id: `doc-${name.toLowerCase()}`,
    type: 'document',
    name,
    fileType: 'md',
    ownerId: 'macro|viewer@example.test',
    createdAt: NOW - index * 60_000,
    updatedAt: NOW - index * 60_000,
    viewedAt: NOW - index * 60_000,
  }) as unknown as WithNotification<EntityData>;

function Fixture() {
  const [entities, setEntities] = createSignal(NAMES.map(doc));
  const [collapse, setCollapse] = createSignal<
    ((id: string) => Promise<void>) | undefined
  >();
  const [expand, setExpand] = createSignal<
    ((id: string) => void) | undefined
  >();
  let list: HTMLDivElement | undefined;

  const delegate: MarkDoneDelegate = {
    canComplete: () => true,
    prepare: (targets) => ({
      hide: () => {
        const leaving = targets
          .map((entity) => entity.id)
          .filter((id) => id !== KEPT);
        const before = entities();
        setEntities((current) =>
          current.filter((entity) => !leaving.includes(entity.id))
        );
        return () => setEntities(before);
      },
      commit: async () => {
        window.__signalDone.push(...targets.map((entity) => entity.id));
        return { undo: async () => {} };
      },
    }),
  };
  const markDone = makeMarkDoneAction({
    notificationSource: () => ({}) as NotificationSource,
    delegate: () => delegate,
  });

  // Swipe rows are keyed by occurrence, not by entity, as in HomeList.
  const rowIdOf = (entityId: string) => `row|${entityId}`;
  const controller = {
    items: {
      all: entities,
      keyOf: (entity: EntityData) => rowIdOf(entity.id),
    },
    focus: { key: () => undefined, set: () => false, clear: () => {} },
    selection: { isSelected: () => false, clear: () => {} },
  } as unknown as ListController<EntityData, unknown>;
  const listState = toEntityActionListState({
    controller,
    getEntity: (entity) => entity,
    collapse: {
      enabled: () => true,
      run: async (entityId) => {
        await collapse()?.(rowIdOf(entityId));
      },
    },
    expand: (entityId) => expand()?.(rowIdOf(entityId)),
  });

  return (
    <div class="fixed inset-0 overflow-y-auto bg-panel text-ink">
      <SwipableRowProvider
        container={() => list}
        canSwipeLeft={() => true}
        onSwipeLeft={(rowId) => {
          const entity = entities().find(
            (candidate) => rowIdOf(candidate.id) === rowId
          );
          if (!entity) return;
          fireAndForget(
            markDone.executeWithSoup([entity], listState),
            'next-soup'
          );
        }}
        setCollapseEntity={setCollapse}
        setExpandEntity={setExpand}
      >
        <div ref={list} class="soup-list flex flex-col pt-4">
          <For each={entities()}>
            {(entity, index) => (
              <InboxListEntity
                entity={entity}
                occurrenceKey={rowIdOf(entity.id)}
                hideCheckbox
                isLastInGroup={index() === entities().length - 1}
              />
            )}
          </For>
        </div>
      </SwipableRowProvider>
    </div>
  );
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <ChannelDirectoryProvider
                directory={staticChannelDirectory(() => [])}
              >
                <EmailLinksContextProvider>
                  <MobileSettingsProvider>
                    <MutationUndoProvider>
                      <Fixture />
                    </MutationUndoProvider>
                  </MobileSettingsProvider>
                </EmailLinksContextProvider>
              </ChannelDirectoryProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root') as HTMLElement
);
