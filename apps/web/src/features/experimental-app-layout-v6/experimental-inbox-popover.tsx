import {
  compileToAst,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { signalFilter } from '@app/features/next-soup/filters/inbox-filters';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import {
  InboxCardLayout,
  toInboxCardDisplayItem,
} from '@app/features/next-soup/soup-view/views/inbox/inbox-card-layouts';
import {
  markChannelTargetSeenOnOpen,
  markReminderSeenOnOpen,
  openEntityInSplitFromUnifiedList,
  scopeChannelNotificationsForEntity,
} from '@app/features/next-soup/utils';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import {
  type EntityData,
  type Notification,
  toNotificationEntity,
  type WithNotification,
} from '@entity';
import {
  markNotificationsForEntityAsDone,
  useNotificationsForEntity,
} from '@notifications';
import ArchiveIcon from '@phosphor/archive.svg';
import BellIcon from '@phosphor/bell.svg';
import { Popover } from '@kobalte/core/popover';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { Button, cn, Surface, Tooltip } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  Show,
  Suspense,
} from 'solid-js';
import { ExperimentalPopoverSplitAction } from './experimental-popover-split-action';

const inboxPreset = getViewPreset('inbox', 'signal');

type EntityWithRawNotifications = EntityData & {
  notifications?: Notification[];
};

function rawEntityNotifications(entity: EntityData) {
  const notifications = (entity as EntityWithRawNotifications).notifications;
  return Array.isArray(notifications) ? notifications : undefined;
}

function InboxPopoverRow(props: {
  entity: EntityData;
  onOpen: (entity: WithNotification<EntityData>) => void;
  onMarkDone: (entity: WithNotification<EntityData>) => void;
}) {
  const notificationSource = useGlobalNotificationSource();
  const rawNotifications = rawEntityNotifications(props.entity);
  const entityWithoutRawNotifications = (() => {
    if (!rawNotifications) return props.entity;
    const { notifications: _notifications, ...entity } =
      props.entity as EntityWithRawNotifications;
    return entity as EntityData;
  })();
  const fallbackNotifications = useNotificationsForEntity(
    notificationSource,
    toNotificationEntity(entityWithoutRawNotifications)
  );
  const entity = createMemo<WithNotification<EntityData>>(() => ({
    ...entityWithoutRawNotifications,
    notifications: () =>
      scopeChannelNotificationsForEntity(
        entityWithoutRawNotifications,
        rawNotifications ?? fallbackNotifications()
      ),
  }));

  return (
    <div class="group/notification-row relative min-w-0">
      <InboxCardLayout
        class="rounded-none! px-4! py-3!"
        item={toInboxCardDisplayItem(entity())}
        onClick={() => props.onOpen(entity())}
      />
      <Tooltip
        label="Mark done"
        placement="right"
        class="absolute bottom-2 right-3 z-1 hidden group-hover/notification-row:inline-flex group-focus-within/notification-row:inline-flex"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          depth={4}
          aria-label="Mark done"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onMarkDone(entity());
          }}
        >
          <ArchiveIcon class="size-3.5" />
        </Button>
      </Tooltip>
    </div>
  );
}

/** Compact Inbox list opened from Experimental v6's global bell button. */
export function ExperimentalInboxPopover(props: {
  hasMockNotification?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [scrollElement, setScrollElement] = createSignal<HTMLElement>();
  const [dismissedEntityKeys, setDismissedEntityKeys] = createSignal(
    new Set<string>()
  );
  const layout = useSplitLayout();
  const notificationSource = useGlobalNotificationSource();
  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: 20, sort_method: 'updated_at' },
      body: compileToAst(queryStateFrom(inboxPreset?.filters ?? {})),
    }),
    () => ({ enabled: open(), staleTime: 30_000 })
  );
  const entityKey = (entity: EntityData) => `${entity.type}:${entity.id}`;
  const entities = createMemo(() =>
    (query.data?.entities ?? []).filter(
      (entity) =>
        signalFilter(entity) && !dismissedEntityKeys().has(entityKey(entity))
    )
  );
  const inboxViewActive = () => {
    const content = globalSplitManager()?.activeSplit()?.content();
    return content?.type === 'component' && content.id === 'notifications';
  };

  const openInboxView = (openInCurrentSplit: boolean) => {
    setOpen(false);
    layout.openWithSplit(
      { type: 'component', id: 'notifications' },
      {
        preferNewSplit: !openInCurrentSplit,
        allowDuplicate: true,
        mergeHistory: false,
        referredFrom: 'sidebar',
      }
    );
    globalSplitManager()?.returnFocus();
  };

  const markEntityDone = async (
    entity: WithNotification<EntityData>
  ) => {
    const key = entityKey(entity);
    setDismissedEntityKeys((current) => new Set(current).add(key));
    try {
      await markNotificationsForEntityAsDone(
        notificationSource,
        toNotificationEntity(entity)
      );
    } catch {
      setDismissedEntityKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const openEntity = (entity: WithNotification<EntityData>) => {
    setOpen(false);
    markReminderSeenOnOpen(entity, notificationSource);
    markChannelTargetSeenOnOpen(entity, notificationSource);
    void openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: true,
      allowDuplicate: true,
      mergeHistory: false,
      referredFrom: 'inbox',
    });
  };

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      gutter={6}
      flip
    >
      <Popover.Trigger
        as={Button}
        variant="ghost"
        size="icon-sm"
        class={cn(
          'relative size-8 rounded-lg text-ink-muted [&_svg]:size-4!',
          (open() || inboxViewActive()) && 'bg-active text-ink'
        )}
        aria-label="Open Inbox"
      >
        <BellIcon />
        <Show when={props.hasMockNotification}>
          <span class="absolute right-1 top-1 size-1.5 rounded-full bg-accent ring-2 ring-page" />
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="z-action-menu w-[28rem] max-w-[calc(100vw-1rem)] outline-none">
          <Surface
            depth={4}
            class="flex max-h-[min(36rem,calc(100vh-4rem))] flex-col overflow-hidden rounded-xl bg-menu shadow-menu"
          >
            <header class="flex shrink-0 items-center justify-between border-b border-edge-muted px-4 py-3">
              <h2 class="min-w-0 truncate text-sm font-semibold text-ink">
                Notifications
              </h2>
              <ExperimentalPopoverSplitAction onOpen={openInboxView} />
            </header>

            <StaticMarkdownContext>
              <div class="relative min-h-0 flex-1">
                <Suspense
                  fallback={
                    <div class="size-full px-4 py-10 text-center text-sm text-ink-extra-muted">
                      Loading notifications…
                    </div>
                  }
                >
                  <div
                    ref={setScrollElement}
                    class="max-h-[min(30rem,calc(100vh-9rem))] overflow-y-auto"
                  >
                    <Show
                      when={entities().length > 0}
                      fallback={
                        <div class="px-4 py-10 text-center text-sm text-ink-extra-muted">
                          {query.isLoading
                            ? 'Loading notifications…'
                            : 'No notifications.'}
                        </div>
                      }
                    >
                      <div class="flex flex-col divide-y divide-ink/[0.05]">
                        <For each={entities()}>
                          {(entity) => (
                            <InboxPopoverRow
                              entity={entity}
                              onOpen={openEntity}
                              onMarkDone={(item) => void markEntityDone(item)}
                            />
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Suspense>
                <ScrollIndicators
                  scrollRef={scrollElement}
                  appearance="gradient"
                  color="var(--color-menu)"
                  noBorderStart
                  noBorderEnd
                />
              </div>
            </StaticMarkdownContext>
          </Surface>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
