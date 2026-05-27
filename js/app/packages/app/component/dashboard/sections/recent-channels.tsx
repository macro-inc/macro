import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { UserIcon } from '@core/component/UserIcon';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { compareDateDesc, formatDate } from '@core/util/date';
import { createTheme, theme as markdownTheme } from '@core/component/LexicalMarkdown/theme';
import { useDisplayName } from '@core/user/displayName';
import { ChannelType } from '@service-comms/generated/models/channelType';
import BuildingIcon from '@phosphor/building.svg';
import UsersIcon from '@phosphor/users.svg';
import { Avatar, Button, Tooltip } from '@ui';
import { createMemo, For, Show } from 'solid-js';

const compactMarkdownTheme = createTheme(
  {
    paragraph: 'm-0 md-p text-[1em]',
    list: {
      listitem: 'm-0',
    },
  },
  markdownTheme
);

type ChannelCardData = {
  id: string;
  name: string;
  type: string;
  latest: string;
  latestFromMe: boolean;
  latestSenderId?: string;
  updatedAt: string;
  unreadCount: number;
  participantCount: number;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function ChannelCard(props: {
  channel: ChannelCardData;
  onOpen: (channelId: string) => void;
}) {
  const [senderName] = useDisplayName(props.channel.latestSenderId as any);
  const senderLabel = () =>
    props.channel.latestSenderId
      ? props.channel.latestFromMe
        ? 'You'
        : senderName()
      : undefined;

  return (
    <button
      class="group flex h-36 min-w-0 flex-col justify-between rounded-2xl border border-edge-muted bg-hover/60 p-4 text-left transition hover:border-edge hover:bg-hover focus:outline-none focus-visible:border-accent"
      onClick={() => props.onOpen(props.channel.id)}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <Avatar size="lg" class="bg-default/20 px-1 text-default">
            <Avatar.Fallback>{initials(props.channel.name)}</Avatar.Fallback>
          </Avatar>
          <div class="flex min-w-0 flex-col gap-0.5">
            <div class="flex min-w-0 items-center gap-1.5">
              <Show when={props.channel.type === ChannelType.organization}>
                <BuildingIcon class="size-3 shrink-0 text-ink-extra-muted" />
              </Show>
              <h3 class="truncate text-xs font-semibold text-ink">
                {props.channel.name}
              </h3>
            </div>
            <span class="flex items-center gap-1.5 text-xxs text-ink-extra-muted">
              <UsersIcon class="size-3" />
              {props.channel.participantCount}
            </span>
          </div>
        </div>
        <Show when={props.channel.unreadCount > 0}>
          <span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-accent px-1.5 text-xxs font-semibold text-surface">
            {props.channel.unreadCount}
          </span>
        </Show>
      </div>

      <div class="flex min-w-0 flex-col gap-1">
        <Show when={senderLabel()}>
          {(label) => (
            <div class="flex items-center gap-1.5 text-xxs font-medium text-ink-muted">
              <Show when={props.channel.latestSenderId}>
                {(senderId) => (
                  <UserIcon
                    id={senderId()}
                    size="sm"
                    suppressClick
                    showTooltip={false}
                  />
                )}
              </Show>
              <Tooltip label={label()}>
                <span class="min-w-0 truncate">{label()}</span>
              </Tooltip>
              <span class="shrink-0 text-ink-extra-muted/70">
                {props.channel.updatedAt}
              </span>
            </div>
          )}
        </Show>
        <div class="line-clamp-2 text-xs/5 text-ink-muted [&_*]:text-xs [&_*]:leading-5">
          <StaticMarkdown
            markdown={props.channel.latest}
            theme={compactMarkdownTheme}
          />
        </div>

      </div>
    </button>
  );
}

export function RecentChannelsSection() {
  const channelsContext = useChannelsContext();
  const notificationSource = useGlobalNotificationSource();
  const currentUserId = useUserId();
  const splitLayout = useSplitLayout();

  const unreadByChannelId = createMemo(() => {
    const counts = new Map<string, number>();
    for (const notification of notificationSource.notifications()) {
      if (
        notification.entity_type !== 'channel' ||
        notification.done ||
        notification.viewed_at
      ) {
        continue;
      }
      counts.set(
        notification.entity_id,
        (counts.get(notification.entity_id) ?? 0) + 1
      );
    }
    return counts;
  });

  const channels = createMemo<ChannelCardData[]>(() =>
    channelsContext
      .channels()
      .filter((channel) => channel.channel_type !== ChannelType.direct_message)
      .sort((a, b) =>
        compareDateDesc(
          a.interacted_at ?? a.latest_message?.created_at ?? a.updated_at,
          b.interacted_at ?? b.latest_message?.created_at ?? b.updated_at
        )
      )
      .slice(0, 4)
      .map((channel) => {
        const latest = channel.latest_message;
        const latestFromMe = latest?.sender_id === currentUserId();
        const latestText = latest?.content?.trim();

        return {
          id: channel.id,
          name: channel.name ?? 'Untitled channel',
          type: channel.channel_type,
          latest: latestText ?? 'No recent messages',
          latestFromMe,
          latestSenderId: latest?.sender_id,
          updatedAt: formatDate(
            channel.interacted_at ?? latest?.created_at ?? channel.updated_at,
            { shortWeekday: true }
          ),
          unreadCount: unreadByChannelId().get(channel.id) ?? 0,
          participantCount: channel.participants.length,
        };
      })
  );

  const openChannel = (channelId: string) => {
    splitLayout.replaceOrInsertSplit({ type: 'channel', id: channelId }, 'dashboard');
  };

  return (
    <section>
      <div class="mb-4 flex items-center justify-between gap-4">
        <h2 class="text-lg font-semibold tracking-tight text-ink">
          Recent channels
        </h2>
        <Button variant="ghost" size="sm" class="rounded-lg">
          View all
        </Button>
      </div>

      <div class="grid max-w-5xl grid-cols-4 gap-3">
        <Show
          when={!channelsContext.isLoading()}
          fallback={
            <For each={[0, 1, 2, 3]}>
              {() => (
                <div class="h-36 rounded-2xl border border-edge-muted bg-hover/60 p-4">
                  <div class="size-9 rounded-xl bg-surface" />
                  <div class="flex flex-col gap-2 pt-6">
                    <div class="h-3 w-3/4 rounded-full bg-ink/10" />
                    <div class="h-2.5 w-1/2 rounded-full bg-ink/5" />
                  </div>
                </div>
              )}
            </For>
          }
        >
          <StaticMarkdownContext>
            <For each={channels()}>
              {(channel) => (
                <ChannelCard channel={channel} onOpen={openChannel} />
              )}
            </For>
          </StaticMarkdownContext>
        </Show>
      </div>
    </section>
  );
}
