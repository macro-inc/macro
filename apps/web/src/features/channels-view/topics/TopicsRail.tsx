import { ViewSidebar } from '@app/components/view-shell';
import { makeMuteAction } from '@app/features/next-soup/actions';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import type { ChannelEntity } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import ListIcon from '@phosphor/list.svg';
import PlusIcon from '@phosphor/plus.svg';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { Button, cn, Dialog, Dropdown, Panel } from '@ui';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useChannelsView } from '../channels-view-context';
import {
  ChannelAvatar,
  ChannelCallIndicator,
  ChannelMutedIndicator,
  IncomingCallActions,
} from '../components/rail/ChannelRailItems';
import { useChannelsRail } from '../components/rail/ChannelsRailContext';
import { useChannelRailItemState } from '../components/rail/hooks/useChannelRailState';
import { openConvertChannelDialog } from './ConvertChannelDialog';
import {
  addChannelToTopic,
  type ChannelTopic,
  createTopic,
  deleteTopic,
  leaveTopicRailChannel,
  removeChannelFromTopic,
  setTopicOrder,
  updateTopic,
  useChannelTopicsQuery,
} from './queries';

type TopicOrderMode = 'custom' | 'alpha' | 'activity' | 'unread';
type DraggedChannel = {
  id: string;
  name: string;
  type: ChannelEntity['channelType'];
  source?: string;
  convertAllowed?: boolean;
};
const modeStorage = createUserScopedStorage('macro:channels:topic-mode:v1');
const collapseStorage = createUserScopedStorage(
  'macro:channels:topic-collapse:v1'
);

function TopicChannelRow(props: {
  channel: ChannelEntity;
  topic?: ChannelTopic;
  topics: ChannelTopic[];
  move: (
    channel: ChannelEntity,
    topic: ChannelTopic,
    add: boolean
  ) => Promise<void>;
}) {
  const view = useChannelsView();
  const item = useChannelRailItemState(() => props.channel.id);
  const userId = useUserId();
  const [addModifier, setAddModifier] = createSignal(false);
  const [hovered, setHovered] = createSignal(false);
  const notificationSource = useGlobalNotificationSource();
  const muteAction = makeMuteAction({
    notificationSource: () => notificationSource,
  });
  const participantsQuery = useChannelParticipantsQuery(() =>
    hovered() ? props.channel.id : ''
  );
  const canConvert = () =>
    props.channel.ownerId === userId() ||
    (participantsQuery.isSuccess &&
      participantsQuery.data.some(
        (participant) =>
          participant.user_id === userId() && participant.role === 'admin'
      ));
  const file = (topic: ChannelTopic, add: boolean) => {
    void props.move(props.channel, topic, add);
  };
  const remove = async () => {
    if (!props.topic) return;
    const topic = props.topic;
    try {
      await removeChannelFromTopic(topic.id, props.channel.id);
      toast.success('Removed from ' + topic.name, {
        actions: [
          {
            label: 'Undo',
            onClick: () => void addChannelToTopic(topic.id, props.channel.id),
          },
        ],
      });
    } catch (error) {
      console.error(error);
      toast.failure('Could not remove channel from topic');
    }
  };
  const leave = async () => {
    try {
      await leaveTopicRailChannel(props.channel.id);
    } catch (error) {
      console.error(error);
      toast.failure('Could not leave channel');
    }
  };
  return (
    <div
      class="group/channel-option flex min-w-0 items-center"
      onMouseEnter={() => setHovered(true)}
      onFocusIn={() => setHovered(true)}
      title={props.topics
        .filter((topic) => topic.channel_ids.includes(props.channel.id))
        .map((topic) => topic.name)
        .join(', ')}
    >
      <ViewSidebar.Item
        as="div"
        role="treeitem"
        tabIndex={0}
        draggable
        aria-current={item().selected ? 'page' : undefined}
        active={item().selected}
        class={cn('min-w-0 flex-1', props.topic && 'ml-4')}
        onClick={(event) => {
          if (event.button === 0) view.setSelectedChannelId(props.channel.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            view.setSelectedChannelId(props.channel.id);
          }
        }}
        onDragStart={(event) => {
          event.dataTransfer?.setData(
            'application/x-macro-channel',
            JSON.stringify({
              id: props.channel.id,
              name: props.channel.name,
              type: props.channel.channelType,
              source: props.topic?.id,
              convertAllowed: canConvert(),
            } satisfies DraggedChannel)
          );
        }}
      >
        <ViewSidebar.Icon>
          <ChannelAvatar channel={props.channel} />
        </ViewSidebar.Icon>
        <span class="min-w-0 flex-1 truncate">{props.channel.name}</span>
        <span class="flex shrink-0 items-center gap-1">
          <ChannelMutedIndicator muted={item().muted} />
          <ChannelCallIndicator
            status={item().incomingCallId ? undefined : item().callStatus}
          />
          <Show when={item().unread}>
            <span
              aria-label="Unread"
              class="size-2 shrink-0 rounded-full bg-accent"
            />
          </Show>
        </span>
        <IncomingCallActions
          callId={item().incomingCallId}
          channelId={props.channel.id}
        />
      </ViewSidebar.Item>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          as={ViewSidebar.Control}
          size="icon-sm"
          variant="ghost"
          label={'Actions for ' + props.channel.name}
          class="opacity-0 group-hover/channel-option:opacity-100 focus:opacity-100"
        >
          <DotsThreeIcon class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-52">
          <Dropdown.Group>
            <Dropdown.GroupLabel>#{props.channel.name}</Dropdown.GroupLabel>
            <Dropdown.Item
              onSelect={() => void muteAction.execute([props.channel])}
            >
              {item().muted ? 'Unmute channel' : 'Mute channel'}
            </Dropdown.Item>
          </Dropdown.Group>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Actions</Dropdown.GroupLabel>
            <Show when={props.channel.channelType === 'team'}>
              <Dropdown.Sub>
                <Dropdown.SubTrigger>Move to topic</Dropdown.SubTrigger>
                <Dropdown.SubContent class="min-w-52">
                  <Dropdown.Group>
                    <For each={props.topics}>
                      {(topic) => (
                        <Dropdown.Item
                          onPointerDown={(event) =>
                            setAddModifier(event.altKey)
                          }
                          onKeyDown={(event) => setAddModifier(event.altKey)}
                          onSelect={() => {
                            const add = addModifier();
                            setAddModifier(false);
                            file(topic, add);
                          }}
                        >
                          <span class="min-w-0 flex-1 truncate">
                            {topic.name}
                          </span>
                          <Show
                            when={topic.channel_ids.includes(props.channel.id)}
                          >
                            <CheckIcon class="size-3.5 text-accent" />
                          </Show>
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                  <div class="border-t border-edge-muted px-2 py-2 text-xs text-ink-muted">
                    Hold ⌥ to add it to a topic without removing it from this
                    one.
                  </div>
                </Dropdown.SubContent>
              </Dropdown.Sub>
              <Show when={props.topic}>
                {(topic) => (
                  <Dropdown.Item onSelect={() => void remove()}>
                    Remove from {topic().name}
                  </Dropdown.Item>
                )}
              </Show>
            </Show>
            <Show
              when={
                (props.channel.channelType === 'private' ||
                  props.channel.channelType === 'public') &&
                canConvert()
              }
            >
              <Dropdown.Item
                onSelect={() =>
                  openConvertChannelDialog({
                    id: props.channel.id,
                    name: props.channel.name,
                    type: props.channel.channelType as 'private' | 'public',
                  })
                }
              >
                Make a team channel…
              </Dropdown.Item>
            </Show>
          </Dropdown.Group>
          <Show when={props.channel.channelType !== 'direct_message'}>
            <Dropdown.Group>
              <Dropdown.Item onSelect={() => void leave()}>
                Leave channel
              </Dropdown.Item>
            </Dropdown.Group>
          </Show>
        </Dropdown.Content>
      </Dropdown>
      <Show
        when={
          (props.channel.channelType === 'private' ||
            props.channel.channelType === 'public') &&
          canConvert()
        }
      >
        <Button
          size="icon-xs"
          variant="ghost"
          label={'Make ' + props.channel.name + ' a team channel'}
          class="opacity-0 group-hover/channel-option:opacity-100 focus:opacity-100"
          onClick={() =>
            openConvertChannelDialog({
              id: props.channel.id,
              name: props.channel.name,
              type: props.channel.channelType as 'private' | 'public',
            })
          }
        >
          ↑
        </Button>
      </Show>
    </div>
  );
}

export function TopicsRailBody() {
  const rail = useChannelsRail();
  const notificationSource = useGlobalNotificationSource();
  const view = useChannelsView();
  const userId = useUserId();
  const topicsQuery = useChannelTopicsQuery(() => true);
  const [mode, setMode] = createSignal<TopicOrderMode>('custom');
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
  const [editor, setEditor] = createSignal<ChannelTopic | 'new'>();
  const [name, setName] = createSignal('');
  const [dropTopicId, setDropTopicId] = createSignal<string>();
  const [dropInsert, setDropInsert] = createSignal<{
    id: string;
    after: boolean;
  }>();

  createEffect(() => {
    const id = userId();
    if (!id) return;
    const savedMode = modeStorage.read(id);
    if (
      savedMode === 'custom' ||
      savedMode === 'alpha' ||
      savedMode === 'activity' ||
      savedMode === 'unread'
    )
      setMode(savedMode);
    const savedCollapse = collapseStorage.read(id);
    if (savedCollapse) {
      try {
        setCollapsed(JSON.parse(savedCollapse));
      } catch {
        /* ignore invalid saved state */
      }
    }
  });
  const changeMode = (next: TopicOrderMode) => {
    setMode(next);
    const id = userId();
    if (id) modeStorage.write(id, next);
  };
  const toggleTopic = (id: string) => {
    const next = { ...collapsed(), [id]: !collapsed()[id] };
    setCollapsed(next);
    const user = userId();
    if (user) collapseStorage.write(user, JSON.stringify(next));
  };
  const topics = createMemo(() =>
    topicsQuery.isSuccess ? topicsQuery.data : []
  );
  const channels = () => rail.sources.channels.items();
  const teamChannels = () =>
    channels().filter((channel) => channel.channelType === 'team');
  const byId = () =>
    new Map(teamChannels().map((channel) => [channel.id, channel]));
  const visibleFor = (topic: ChannelTopic) =>
    topic.channel_ids
      .map((id) => byId().get(id))
      .filter((item): item is ChannelEntity => !!item);
  const sortedTopics = createMemo(() => {
    const result = topics().slice();
    const unread = rail.channelActivity.unreadChannelIds();
    switch (mode()) {
      case 'alpha':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'activity':
        result.sort((a, b) => {
          const score = (topic: ChannelTopic) =>
            Math.max(
              0,
              ...visibleFor(topic).map((channel) =>
                new Date(
                  channel.latestRootMessage?.createdAt ?? channel.updatedAt ?? 0
                ).getTime()
              )
            );
          return score(b) - score(a);
        });
        break;
      case 'unread':
        result.sort((a, b) => {
          const score = (topic: ChannelTopic) => {
            const ids = new Set(topic.channel_ids);
            const mentions = notificationSource
              .notifications()
              .filter(
                (notification) =>
                  ids.has(notification.entity_id) &&
                  !notificationIsRead(notification) &&
                  notification.notification_event_type === 'channel_mention'
              ).length;
            const unreads = visibleFor(topic).filter((channel) =>
              unread.has(channel.id)
            ).length;
            return [mentions, unreads] as const;
          };
          const left = score(a);
          const right = score(b);
          return right[0] - left[0] || right[1] - left[1];
        });
        break;
      default:
        result.sort(
          (a, b) =>
            (a.sort_position ?? a.sort_order) -
            (b.sort_position ?? b.sort_order)
        );
    }
    return result;
  });
  const uncategorized = () => {
    const filed = new Set(topics().flatMap((topic) => topic.channel_ids));
    return teamChannels().filter((channel) => !filed.has(channel.id));
  };
  const order = async (ids: string[], switched: boolean) => {
    const previous = sortedTopics().map((topic) => topic.id);
    try {
      await setTopicOrder(ids);
      changeMode('custom');
      toast.success(
        'Topics reordered' + (switched ? ' · switched to custom order' : ''),
        {
          actions: [
            { label: 'Undo', onClick: () => void setTopicOrder(previous) },
          ],
        }
      );
    } catch (error) {
      console.error(error);
      toast.failure('Could not reorder topics');
    }
  };
  const moveTopic = (topic: ChannelTopic, direction: -1 | 1) => {
    const ids = sortedTopics().map((item) => item.id);
    const index = ids.indexOf(topic.id);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= ids.length) return;
    ids.splice(index, 1);
    ids.splice(nextIndex, 0, topic.id);
    void order(ids, mode() !== 'custom');
  };
  const moveChannel = async (
    channel: ChannelEntity,
    topic: ChannelTopic,
    add: boolean
  ) => {
    if (channel.channelType !== 'team') {
      if (
        channel.channelType === 'private' ||
        channel.channelType === 'public'
      ) {
        openConvertChannelDialog({
          id: channel.id,
          name: channel.name,
          type: channel.channelType,
          topicId: topic.id,
        });
      }
      return;
    }
    const previous = topics().filter((item) =>
      item.channel_ids.includes(channel.id)
    );
    if (previous.some((item) => item.id === topic.id)) {
      toast.success('Already in ' + topic.name);
      return;
    }
    try {
      await addChannelToTopic(topic.id, channel.id);
      if (!add) {
        for (const source of previous)
          await removeChannelFromTopic(source.id, channel.id);
      }
      const undo = async () => {
        try {
          await removeChannelFromTopic(topic.id, channel.id);
          for (const source of previous)
            await addChannelToTopic(source.id, channel.id);
        } catch (error) {
          console.error(error);
          toast.failure('Could not undo topic move');
        }
      };
      toast.success((add ? 'Added to ' : 'Moved to ') + topic.name, {
        actions: [{ label: 'Undo', onClick: () => void undo() }],
      });
    } catch (error) {
      console.error(error);
      toast.failure('Could not file channel');
    }
  };
  const onDropTopic = (event: DragEvent, topic: ChannelTopic) => {
    event.preventDefault();
    const insertAfter = dropInsert()?.after ?? false;
    setDropTopicId(undefined);
    setDropInsert(undefined);
    const channelData = event.dataTransfer?.getData(
      'application/x-macro-channel'
    );
    if (channelData) {
      try {
        const dragged = JSON.parse(channelData) as DraggedChannel;
        if (
          (dragged.type === 'private' || dragged.type === 'public') &&
          !dragged.convertAllowed
        )
          return;
        const channel = channels().find((item) => item.id === dragged.id);
        if (channel) void moveChannel(channel, topic, event.altKey);
      } catch {
        /* invalid drag payload */
      }
      return;
    }
    const draggedId = event.dataTransfer?.getData('application/x-macro-topic');
    if (!draggedId || draggedId === topic.id) return;
    const ids = sortedTopics()
      .map((item) => item.id)
      .filter((id) => id !== draggedId);
    const index = ids.indexOf(topic.id);
    ids.splice(index + (insertAfter ? 1 : 0), 0, draggedId);
    void order(ids, mode() !== 'custom');
  };
  const saveTopic = async () => {
    const target = editor();
    if (!target || !name().trim()) return;
    try {
      if (target === 'new') {
        const id = await createTopic(name().trim());
        toast.success('Topic created', {
          actions: [{ label: 'Undo', onClick: () => void deleteTopic(id) }],
        });
      } else {
        await updateTopic(target.id, name().trim());
        toast.success('Topic renamed', {
          actions: [
            {
              label: 'Undo',
              onClick: () => void updateTopic(target.id, target.name),
            },
          ],
        });
      }
      setEditor(undefined);
    } catch (error) {
      console.error(error);
      toast.failure('Could not save topic');
    }
  };
  const openEditor = (topic?: ChannelTopic) => {
    setName(topic?.name ?? '');
    setEditor(topic ?? 'new');
  };
  const flatSection = (
    id: 'external' | 'private' | 'direct_messages',
    label: string,
    items: ChannelEntity[]
  ) => (
    <section class="flex flex-col gap-0.5">
      <button
        class="flex h-8 items-center gap-1 rounded-lg px-2 text-left text-xs font-medium text-ink-muted"
        aria-expanded={view.state.expandedGroups[id]}
        onClick={() => view.setGroupOpen(id, !view.state.expandedGroups[id])}
      >
        <CaretDownIcon
          class={cn('size-3', !view.state.expandedGroups[id] && '-rotate-90')}
        />
        {label}
        <Show
          when={
            items.filter((channel) =>
              rail.channelActivity.unreadChannelIds().has(channel.id)
            ).length > 0
          }
        >
          <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none tabular-nums text-accent-contrast">
            {
              items.filter((channel) =>
                rail.channelActivity.unreadChannelIds().has(channel.id)
              ).length
            }
          </span>
        </Show>
      </button>
      <Show when={view.state.expandedGroups[id]}>
        <For each={items}>
          {(channel) => (
            <TopicChannelRow
              channel={channel}
              topics={topics()}
              move={moveChannel}
            />
          )}
        </For>
      </Show>
    </section>
  );

  return (
    <>
      <div
        class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-4"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (
            element.scrollTop + element.clientHeight <
            element.scrollHeight - 160
          )
            return;
          for (const source of [
            rail.sources.channels,
            rail.sources.direct_messages,
          ]) {
            if (source.hasMore() && !source.isLoadingMore())
              void source.loadMore();
          }
        }}
      >
        <section class="flex flex-col gap-0.5">
          <div class="flex h-8 items-center">
            <button
              class="flex min-w-0 flex-1 items-center gap-1 rounded-lg px-2 text-left text-xs font-medium text-ink-muted"
              aria-expanded={view.state.expandedGroups.topics}
              onClick={() =>
                view.setGroupOpen('topics', !view.state.expandedGroups.topics)
              }
            >
              <CaretDownIcon
                class={cn(
                  'size-3',
                  !view.state.expandedGroups.topics && '-rotate-90'
                )}
              />
              Topics
            </button>
            <Dropdown placement="bottom-end">
              <Dropdown.Trigger
                as={ViewSidebar.Control}
                size="icon-sm"
                variant="ghost"
                label="Topic order"
              >
                <ListIcon class="size-4" />
              </Dropdown.Trigger>
              <Dropdown.Content class="min-w-52">
                <Dropdown.Group>
                  <Dropdown.RadioGroup
                    value={mode()}
                    onChange={(value) => {
                      const next = value as TopicOrderMode;
                      if (next === 'custom' && mode() !== 'custom') {
                        void order(
                          sortedTopics().map((topic) => topic.id),
                          false
                        );
                      } else changeMode(next);
                    }}
                  >
                    <Dropdown.RadioItem value="custom" closeOnSelect>
                      Custom{' '}
                      <span class="ml-2 text-xs text-ink-muted">
                        Drag topics to arrange them
                      </span>
                    </Dropdown.RadioItem>
                    <Dropdown.RadioItem value="alpha" closeOnSelect>
                      A–Z
                    </Dropdown.RadioItem>
                    <Dropdown.RadioItem value="activity" closeOnSelect>
                      Recent activity
                    </Dropdown.RadioItem>
                    <Dropdown.RadioItem value="unread" closeOnSelect>
                      Unread first
                    </Dropdown.RadioItem>
                  </Dropdown.RadioGroup>
                </Dropdown.Group>
                <div class="border-t border-edge-muted px-2 py-2 text-xs text-ink-muted">
                  Your order only — everyone on the team arranges topics their
                  own way.
                </div>
              </Dropdown.Content>
            </Dropdown>
            <Dropdown placement="bottom-end">
              <Dropdown.Trigger
                as={ViewSidebar.Control}
                size="icon-sm"
                variant="ghost"
                label="Create"
              >
                <PlusIcon class="size-4" />
              </Dropdown.Trigger>
              <Dropdown.Content class="min-w-48">
                <Dropdown.Group>
                  <Dropdown.Item onSelect={() => openNewChannelModal('team')}>
                    New team channel
                  </Dropdown.Item>
                  <Dropdown.Item
                    onSelect={() => openNewChannelModal('private')}
                  >
                    New private channel
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={() => openNewChannelModal('public')}>
                    New external channel
                  </Dropdown.Item>
                </Dropdown.Group>
                <Dropdown.Group>
                  <Dropdown.Item onSelect={() => openEditor()}>
                    New topic
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </div>
          <Show when={view.state.expandedGroups.topics}>
            <For each={sortedTopics()}>
              {(topic, index) => (
                <div
                  class={cn(
                    'rounded-lg',
                    dropTopicId() === topic.id &&
                      'bg-accent/10 ring-1 ring-inset ring-accent',
                    dropInsert()?.id === topic.id &&
                      (dropInsert()?.after
                        ? 'border-b-2 border-accent'
                        : 'border-t-2 border-accent')
                  )}
                  onDragOver={(event) => {
                    if (
                      event.dataTransfer?.types.includes(
                        'application/x-macro-channel'
                      )
                    ) {
                      event.preventDefault();
                      setDropTopicId(topic.id);
                      setDropInsert(undefined);
                    } else if (
                      event.dataTransfer?.types.includes(
                        'application/x-macro-topic'
                      )
                    ) {
                      event.preventDefault();
                      setDropTopicId(undefined);
                      const bounds =
                        event.currentTarget.firstElementChild?.getBoundingClientRect();
                      if (!bounds) return;
                      setDropInsert({
                        id: topic.id,
                        after: event.clientY > bounds.top + bounds.height / 2,
                      });
                    }
                  }}
                  onDragLeave={() => {
                    setDropTopicId(undefined);
                    setDropInsert(undefined);
                  }}
                  onDrop={(event) => onDropTopic(event, topic)}
                >
                  <div class="group/topic flex h-8 items-center">
                    <button
                      draggable={true}
                      aria-label={'Reorder ' + topic.name}
                      class="px-1 text-ink-extra-muted opacity-0 group-hover/topic:opacity-100 focus:opacity-100"
                      onDragStart={(event) =>
                        event.dataTransfer?.setData(
                          'application/x-macro-topic',
                          topic.id
                        )
                      }
                    >
                      ⋮⋮
                    </button>
                    <button
                      class="flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1 text-left text-sm text-ink"
                      aria-expanded={!collapsed()[topic.id]}
                      onClick={() => toggleTopic(topic.id)}
                    >
                      <CaretDownIcon
                        class={cn(
                          'size-3',
                          collapsed()[topic.id] && '-rotate-90'
                        )}
                      />
                      <span class="min-w-0 truncate">{topic.name}</span>
                    </button>
                    <Dropdown placement="bottom-end">
                      <Dropdown.Trigger
                        as={ViewSidebar.Control}
                        size="icon-sm"
                        variant="ghost"
                        label={'Add channels to ' + topic.name}
                        class="opacity-0 group-hover/topic:opacity-100 focus:opacity-100"
                      >
                        <PlusIcon class="size-3.5" />
                      </Dropdown.Trigger>
                      <Dropdown.Content class="max-h-64 min-w-48 overflow-y-auto">
                        <Dropdown.Group>
                          <For
                            each={teamChannels().filter(
                              (channel) =>
                                !topic.channel_ids.includes(channel.id)
                            )}
                          >
                            {(channel) => (
                              <Dropdown.Item
                                onSelect={() =>
                                  void moveChannel(channel, topic, true)
                                }
                              >
                                {channel.name}
                              </Dropdown.Item>
                            )}
                          </For>
                        </Dropdown.Group>
                      </Dropdown.Content>
                    </Dropdown>
                    <Dropdown placement="bottom-end">
                      <Dropdown.Trigger
                        as={ViewSidebar.Control}
                        size="icon-sm"
                        variant="ghost"
                        label={'Actions for ' + topic.name}
                        class="opacity-0 group-hover/topic:opacity-100 focus:opacity-100"
                      >
                        <DotsThreeIcon class="size-4" />
                      </Dropdown.Trigger>
                      <Dropdown.Content class="min-w-48">
                        <Dropdown.Group>
                          <Dropdown.GroupLabel>Actions</Dropdown.GroupLabel>
                          <Show when={index() > 0}>
                            <Dropdown.Item
                              onSelect={() => moveTopic(topic, -1)}
                            >
                              Move up
                            </Dropdown.Item>
                          </Show>
                          <Show when={index() < sortedTopics().length - 1}>
                            <Dropdown.Item onSelect={() => moveTopic(topic, 1)}>
                              Move down
                            </Dropdown.Item>
                          </Show>
                          <Dropdown.Sub>
                            <Dropdown.SubTrigger>
                              Add channels to topic
                            </Dropdown.SubTrigger>
                            <Dropdown.SubContent class="max-h-64 min-w-48 overflow-y-auto">
                              <Dropdown.Group>
                                <For
                                  each={teamChannels().filter(
                                    (channel) =>
                                      !topic.channel_ids.includes(channel.id)
                                  )}
                                >
                                  {(channel) => (
                                    <Dropdown.Item
                                      onSelect={() =>
                                        void moveChannel(channel, topic, true)
                                      }
                                    >
                                      {channel.name}
                                    </Dropdown.Item>
                                  )}
                                </For>
                              </Dropdown.Group>
                            </Dropdown.SubContent>
                          </Dropdown.Sub>
                          <Dropdown.Item onSelect={() => openEditor(topic)}>
                            Rename topic
                          </Dropdown.Item>
                        </Dropdown.Group>
                      </Dropdown.Content>
                    </Dropdown>
                  </div>
                  <For
                    each={visibleFor(topic).filter(
                      (channel) =>
                        !collapsed()[topic.id] ||
                        rail.channelActivity.unreadChannelIds().has(channel.id)
                    )}
                  >
                    {(channel) => (
                      <TopicChannelRow
                        channel={channel}
                        topic={topic}
                        topics={topics()}
                        move={moveChannel}
                      />
                    )}
                  </For>
                  <Show
                    when={
                      !collapsed()[topic.id] && visibleFor(topic).length === 0
                    }
                  >
                    <div class="px-7 py-2 text-xs italic text-ink-extra-muted">
                      Drop a channel here
                    </div>
                  </Show>
                </div>
              )}
            </For>
            <Show when={uncategorized().length > 0}>
              <section>
                <div class="flex h-8 items-center gap-1 px-2 text-sm text-ink-muted">
                  Uncategorized
                </div>
                <For each={uncategorized()}>
                  {(channel) => (
                    <TopicChannelRow
                      channel={channel}
                      topics={topics()}
                      move={moveChannel}
                    />
                  )}
                </For>
              </section>
            </Show>
          </Show>
        </section>
        <div class="mt-3 flex flex-col gap-2">
          {flatSection(
            'external',
            'External',
            channels().filter((channel) => channel.channelType === 'public')
          )}
          {flatSection(
            'private',
            'Private',
            channels().filter((channel) => channel.channelType === 'private')
          )}
          {flatSection(
            'direct_messages',
            'Direct messages',
            rail.sources.direct_messages.items().slice()
          )}
        </div>
      </div>
      <Dialog
        open={!!editor()}
        onOpenChange={(open) => !open && setEditor(undefined)}
      >
        <Panel depth={2} class="w-[min(26rem,calc(100vw-2rem))] rounded-xl">
          <Panel.Body>
            <form
              class="flex flex-col gap-4 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTopic();
              }}
            >
              <Dialog.Title class="text-lg font-semibold text-ink">
                {editor() === 'new' ? 'New topic' : 'Rename topic'}
              </Dialog.Title>
              <input
                class="h-9 rounded-lg border border-edge-muted bg-input px-3 text-sm text-ink outline-none"
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                placeholder="Topic name"
                autofocus
              />
              <div class="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditor(undefined)}>
                  Cancel
                </Button>
                <Button variant="cta" type="submit" disabled={!name().trim()}>
                  Save
                </Button>
              </div>
            </form>
          </Panel.Body>
        </Panel>
      </Dialog>
    </>
  );
}
