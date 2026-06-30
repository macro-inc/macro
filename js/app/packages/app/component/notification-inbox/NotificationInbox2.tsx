import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import {
  compileToAst,
  defineQueryFilters,
  type Query,
  queryStateFrom,
} from '@app/component/next-soup/filters/filter-store';
import {
  InboxCardLayout,
  toInboxCardDisplayItem,
} from '@app/component/notification-inbox/inbox-card-layouts';
import { PreviewPanel } from '@app/component/PreviewPanel';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Resize } from '@core/component/Resize';
import { TabsInset } from '@core/component/TabsInset';
import { useChannelsContext } from '@core/context/channels';
import {
  type EntityData,
  toNotificationEntity,
  type WithNotification,
} from '@entity';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import {
  type UnifiedNotification,
  useEntityTypeNotifications,
  useNotificationsForEntity,
} from '@notifications';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import EyeSlashIcon from '@phosphor-icons/core/regular/eye-slash.svg?component-solid';
import { useUserId } from '@queries/auth';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { Button, cn, Dropdown, Tooltip } from '@ui';
import { startOfDay, subWeeks } from 'date-fns';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { type VirtualizerHandle, VList } from 'virtua/solid';

type ReadFilter = 'all' | 'unread' | 'read';
type InboxMode = 'signal' | 'noise' | 'all';

const readFilterSeen = (readFilter: ReadFilter) => {
  if (readFilter === 'all') return undefined;
  return readFilter === 'read';
};

const inboxQueryFilters = (
  mode: InboxMode,
  readFilter: ReadFilter,
  userId: string | undefined,
  channelNotifications: UnifiedNotification[]
): Query => {
  const seen = readFilterSeen(readFilter);

  const seenFilter =
    seen === undefined
      ? {}
      : {
          documentSeen: seen,
          emailSeen: seen,
          channelSeen: seen,
          chatSeen: seen,
          folderSeen: seen,
        };

  const mentionedMessages = channelNotifications
    .map((n) =>
      n.notification_metadata.tag === 'channel_mention'
        ? (n.notification_metadata.content.threadId ??
          n.notification_metadata.content.messageId)
        : n.notification_metadata.tag === 'channel_message_reply'
          ? n.notification_metadata.content.threadId
          : undefined
    )
    .filter(Boolean);

  if (mode === 'all') {
    return defineQueryFilters({
      include: {
        documentId: [],
        threadId: [],
        channelThreadId: mentionedMessages as string[],
        chatId: [],
        callId: [],
        foreignEntityRecordId: [],
        ...seenFilter,
      },
      emailView: 'all',
    });
  }

  if (mode === 'noise') {
    return defineQueryFilters({
      include: {
        documentDone: false,
        emailDone: false,
        emailImportance: false,
        channelDone: false,
        channelThreadId: mentionedMessages as string[],
        chatDone: false,
        callId: [],
        folderDone: false,
        emailShared: 'exclude',
        ...seenFilter,
      },
      emailView: 'inbox',
    });
  }

  const twoWeeksAgo = subWeeks(startOfDay(new Date()), 2).toISOString();
  return defineQueryFilters({
    include: {
      documentDone: false,
      documentUpdatedAt: { gte: twoWeeksAgo },
      emailDone: false,
      emailImportance: true,
      emailUpdatedAt: { gte: twoWeeksAgo },
      channelDone: false,
      channelThreadId: mentionedMessages as string[],
      chatDone: false,
      chatUpdatedAt: { gte: twoWeeksAgo },
      // callId: [],
      folderDone: false,
      folderUpdatedAt: { gte: twoWeeksAgo },
      emailShared: 'exclude',
      ...seenFilter,
    },
    exclude: {
      // channelThreadRootSenderId: userId ? [userId] : [],
    },
    emailView: 'inbox',
  });
};

export function NotificationInbox2() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const [readFilter, setReadFilter] = createSignal<ReadFilter>('unread');
  const [inboxMode, setInboxMode] = createSignal<InboxMode>('signal');
  const [previewVisible, setPreviewVisible] = createSignal(true);

  const userId = useUserId();

  const notificationSource = useGlobalNotificationSource();

  const channelNotifications = useEntityTypeNotifications(
    notificationSource,
    'channel'
  );

  const channels = useChannelsContext();

  const getChannelName = (channelId: string) => {
    return channels.channelsById()[channelId]?.name;
  };

  const attachNotifications = (
    entity: EntityData
  ): WithNotification<EntityData> => {
    const notifications = createMemo(() => {
      const n = useNotificationsForEntity(
        notificationSource,
        toNotificationEntity(entity)
      );

      if (entity.type === 'channel_thread') {
        return n().filter((i) => {
          const metadata = i.notification_metadata;

          return match(metadata)
            .with(
              { tag: 'channel_message_send' },
              (m) => m.content.messageId === entity.messageId
            )
            .with(
              { tag: 'channel_mention' },
              (m) => m.content.messageId === entity.messageId
            )
            .with(
              { tag: 'channel_message_reply' },
              (m) => m.content.threadId === entity.messageId
            )
            .otherwise(() => false);
        });
      }

      return n();
    });

    return {
      ...entity,
      name:
        entity.type !== 'channel_thread'
          ? entity.name
          : (getChannelName(entity.channelId) ?? 'Unknown channel'),
      notifications,
    };
  };

  const activeSoupQuery = createMemo(() =>
    inboxQueryFilters(
      inboxMode(),
      readFilter(),
      userId(),
      channelNotifications()
    )
  );

  const soupQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(queryStateFrom(activeSoupQuery())),
    }),
    () => ({
      enabled: true,
      showSupportedForeignEntities: true,
    })
  );

  const entities = createMemo(() => {
    const items = soupQuery.data?.entities ?? [];

    return items.map(attachNotifications);
  });

  const displayItems = createMemo(() =>
    entities().map((entity) => toInboxCardDisplayItem(entity))
  );
  const [selectedEntity, setSelectedEntity] =
    createSignal<WithNotification<EntityData>>();
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();

  const onScroll = () => {
    const handle = virtualHandle();
    if (!handle) return;
    const distanceFromEnd =
      handle.scrollSize - handle.viewportSize - handle.scrollOffset;
    if (distanceFromEnd > 600) return;
    if (!soupQuery.hasNextPage || soupQuery.isFetchingNextPage) return;
    void soupQuery.fetchNextPage();
  };

  createEffect(() => {
    const [getPreview, setPreview] = panel.previewState;
    if (previewVisible() !== getPreview()) setPreview(previewVisible());
  });

  return (
    <div class="relative size-full min-h-0 bg-surface" data-list-view="inbox3">
      <Resize.Zone direction="horizontal" gutter={0}>
        <Resize.Panel
          id="notification-inbox3-list"
          index={0}
          maxSize={previewVisible() ? 840 : undefined}
          minSize={200}
        >
          <div
            class={cn(
              'size-full min-w-0 min-h-0',
              previewVisible() && 'border-r border-edge-muted'
            )}
          >
            <SplitHeaderLeft>
              <div class="flex h-full shrink-0 items-center gap-2">
                <AnimatedInboxIcon class="size-4 text-ink-muted" />
                <span class="text-base font-bold">Inbox</span>
                <Tooltip label="Preview">
                  <Button
                    class="h-7 bg-surface text-ink-muted"
                    depth={2}
                    size="sm"
                    variant={previewVisible() ? 'active' : 'base'}
                    onClick={() => setPreviewVisible((value) => !value)}
                  >
                    {previewVisible() ? <EyeSlashIcon /> : <EyeIcon />}
                    <span>Preview</span>
                  </Button>
                </Tooltip>
              </div>
            </SplitHeaderLeft>
            <div class="flex size-full min-h-0 flex-col bg-surface p-2">
              <div class="mb-2 flex shrink-0 items-center gap-2">
                <Dropdown placement="bottom-start" gutter={4}>
                  <Dropdown.Trigger
                    class="h-7 bg-surface text-ink-muted capitalize"
                    depth={2}
                    size="sm"
                    variant="base"
                  >
                    {inboxMode()}
                  </Dropdown.Trigger>
                  <Dropdown.Content>
                    <Dropdown.Group>
                      <For each={['signal', 'noise', 'all'] as const}>
                        {(mode) => (
                          <Dropdown.Item
                            class="cursor-default px-2.5 py-1.5 text-sm capitalize text-ink-muted outline-none hover:bg-hover"
                            onSelect={() => setInboxMode(mode)}
                          >
                            {mode}
                          </Dropdown.Item>
                        )}
                      </For>
                    </Dropdown.Group>
                  </Dropdown.Content>
                </Dropdown>
                <TabsInset
                  class="ml-auto h-auto w-fit"
                  list={[
                    { value: 'unread', label: 'Unread' },
                    { value: 'read', label: 'Read' },
                    { value: 'all', label: 'All' },
                  ]}
                  value={readFilter()}
                  onChange={(value) => setReadFilter(value as ReadFilter)}
                />
              </div>
              <div class="flex min-h-0 flex-1 flex-col">
                <StaticMarkdownContext>
                  <VList
                    ref={setVirtualHandle}
                    data={displayItems()}
                    class="min-h-0 flex-1 scrollbar-hidden"
                    style={{ height: '100%', width: '100%' }}
                    onScroll={onScroll}
                  >
                    {(item) => (
                      <InboxCardLayout
                        item={item}
                        selected={selectedEntity()?.id === item.entity.id}
                        onClick={() => setSelectedEntity(item.entity)}
                      />
                    )}
                  </VList>
                </StaticMarkdownContext>
              </div>
            </div>
          </div>
        </Resize.Panel>
        <Show when={previewVisible()}>
          <Resize.Panel
            id="notification-inbox3-preview"
            index={2}
            minSize={300}
            target={{ kind: 'percent', percent: 70 }}
          >
            <div class="size-full min-h-0 min-w-0">
              <Show
                fallback={
                  <div class="flex size-full items-center justify-center text-sm text-ink-extra-muted">
                    Select a notification to preview it
                  </div>
                }
                when={selectedEntity()}
              >
                {(entity) => (
                  <PreviewPanel
                    orchestrator={orchestrator}
                    selectedEntity={entity()}
                    splitPanelContext={panel}
                  />
                )}
              </Show>
            </div>
          </Resize.Panel>
        </Show>
      </Resize.Zone>
    </div>
  );
}
