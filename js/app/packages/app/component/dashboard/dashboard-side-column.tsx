import { useGlobalNotificationSource } from "@app/component/GlobalAppState";
import { DashboardSectionBoundary } from "@app/component/dashboard/dashboard-section-boundary";
import { globalSplitManager } from "@app/signal/splitLayout";
import { setAutomationComposerOpen } from "@block-automation/component";
import { DashboardNotificationList } from "@app/component/dashboard/sections/notifications";
import { EntityIcon } from "@core/component/EntityIcon";
import { formatDate } from "@core/util/date";
import type { AutomationEntity, ChannelEntity } from "@entity";
import { formatDateAndTime } from "@entity/utils/timestamp";
import { notificationIsRead } from "@notifications";
import { useAutomationEntities } from "@queries/agent-schedule/entities";
import { useSoupItemsQuery } from "@queries/soup/items";
import ArrowRightIcon from "@phosphor/arrow-right.svg";
import CaretDownIcon from "@phosphor/caret-down.svg";
import BellIcon from "@phosphor/bell.svg";
import RobotIcon from "@phosphor/robot.svg";
import { Button, Layer } from "@ui";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";

function SideColumnSection(props: {
  title: string;
  viewAllLabel: string;
  onViewAll: () => void;
  children: JSX.Element;
}) {
  const [collapsed, setCollapsed] = createSignal(false);

  return (
    <section class="flex flex-col gap-2">
      <Layer depth={2}>
        <div class="group/header relative flex w-full items-center gap-2.5 px-2 py-2 text-base font-semibold tracking-tight text-ink">
          <button
            class="peer/collapse absolute inset-0 rounded-lg border border-transparent bg-transparent transition hover:border-edge-muted hover:bg-surface focus:outline-none focus-visible:border-edge-muted focus-visible:bg-surface"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed()}
            aria-label={`${collapsed() ? "Expand" : "Collapse"} ${props.title}`}
          />
          <div class="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5 pr-20">
            <Layer depth={3}>
              <div class="flex size-4.5 items-center justify-center rounded-md bg-transparent peer-hover/collapse:bg-active peer-focus-visible/collapse:bg-active">
                <CaretDownIcon
                  class="size-2.5 transition"
                  classList={{ "-rotate-90": collapsed() }}
                />
              </div>
            </Layer>
            <h2 class="min-w-0 flex-1 truncate">{props.title}</h2>
          </div>
          <Button
            variant="base"
            size="sm"
            depth={3}
            class="absolute right-2 top-1/2 z-10 h-6 -translate-y-1/2 rounded-md bg-surface px-1.5 text-xxs opacity-0 transition group-hover/header:opacity-100 focus-visible:opacity-100"
            onClick={props.onViewAll}
          >
            View all
            <ArrowRightIcon class="size-3" />
          </Button>
        </div>
      </Layer>
      <Show when={!collapsed()}>{props.children}</Show>
    </section>
  );
}

function openInboxView() {
  globalSplitManager()?.openWithSplit(
    { type: "component", id: "inbox" },
    { activate: true, referredFrom: "dashboard" },
  );
}

function openAutomationsView() {
  globalSplitManager()?.openWithSplit(
    { type: "component", id: "agents" },
    { activate: true, referredFrom: "dashboard" },
  );
}

function openAutomation(automation: AutomationEntity) {
  globalSplitManager()?.openWithSplit(
    { type: "automation", id: automation.id },
    { activate: true, referredFrom: "dashboard" },
  );
}

function AutomationSummary(props: { automation: AutomationEntity }) {
  const status = () => {
    if (props.automation.isRunning) return "Running";
    if (!props.automation.enabled) return "Paused";
    return props.automation.nextRunAt
      ? `Next ${formatDateAndTime(props.automation.nextRunAt)}`
      : "Active";
  };

  return (
    <button
      class="group w-full rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={() => openAutomation(props.automation)}
    >
      <div class="flex items-center gap-2">
        <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-muted transition group-hover:text-ink">
          <RobotIcon class="size-3.5" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <p class="truncate text-xs font-semibold text-ink">
            {props.automation.name}
          </p>
          <p class="truncate text-xxs text-ink-muted">{status()}</p>
        </div>
      </div>
    </button>
  );
}

function openChannelsView() {
  globalSplitManager()?.openWithSplit(
    { type: "component", id: "channels" },
    { activate: true, referredFrom: "dashboard" },
  );
}

function openChannel(channelId: string) {
  globalSplitManager()?.openWithSplit(
    { type: "channel", id: channelId },
    { activate: true, referredFrom: "dashboard" },
  );
}

function channelDisplayName(name: string | null | undefined) {
  const trimmed = name?.trim().replace(/^#+/, "").trim();
  return trimmed || "Untitled channel";
}

function ChannelSummary(props: {
  channel: ChannelEntity;
  unreadCount: number;
}) {
  const latest = () => props.channel.latestMessage;
  const latestText = () => latest()?.content?.trim() || "No recent messages";
  const time = () =>
    formatDate(
      props.channel.interactedAt ??
        latest()?.createdAt ??
        props.channel.updatedAt,
      { shortWeekday: true },
    );

  return (
    <button
      class="group w-full rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={() => openChannel(props.channel.id)}
    >
      <div class="flex items-start gap-2">
        <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover transition group-hover:bg-active">
          <EntityIcon
            targetType={props.channel.channelType || "channel"}
            size="sm"
            class="shrink-0"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <div class="flex min-w-0 flex-1 items-center gap-1.5">
              <p class="min-w-0 truncate text-xs font-semibold text-ink">
                {channelDisplayName(props.channel.name)}
              </p>
              <Show when={props.unreadCount > 0}>
                <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] font-bold text-surface">
                  {props.unreadCount}
                </span>
              </Show>
            </div>
            <span class="shrink-0 text-xxs text-ink-extra-muted">{time()}</span>
          </div>
          <p class="line-clamp-2 text-xs/5 text-ink-muted">{latestText()}</p>
        </div>
      </div>
    </button>
  );
}

function RecentChannelsColumnSection() {
  const notificationSource = useGlobalNotificationSource();

  const unreadByChannelId = createMemo(() => {
    const counts = new Map<string, number>();
    for (const notification of notificationSource.notifications()) {
      if (
        notification.entity_type !== "channel" ||
        notification.done ||
        notificationIsRead(notification)
      ) {
        continue;
      }
      counts.set(
        notification.entity_id,
        (counts.get(notification.entity_id) ?? 0) + 1,
      );
    }
    return counts;
  });

  const channelsQuery = useSoupItemsQuery(
    () => ({
      params: { limit: 5, sort_method: "viewed_updated" },
      body: {
        call_filters: { call_ids: ["00000000-0000-0000-0000-000000000000"] },
        chat_filters: { chat_ids: ["00000000-0000-0000-0000-000000000000"] },
        document_filters: {
          document_ids: ["00000000-0000-0000-0000-000000000000"],
        },
        email_filters: {
          email_thread_ids: ["00000000-0000-0000-0000-000000000000"],
        },
        project_filters: {
          project_ids: ["00000000-0000-0000-0000-000000000000"],
        },
        channel_filters: {
          channel_types: ["public", "organization", "private", "team"],
        },
      },
    }),
    () => ({ staleTime: 5 * 60 * 1000 }),
  );

  const channels = createMemo(() =>
    (channelsQuery.data ?? []).filter(
      (entity): entity is ChannelEntity => entity.type === "channel",
    ),
  );

  return (
    <SideColumnSection
      title="Recent channels"
      viewAllLabel="View channels"
      onViewAll={openChannelsView}
    >
      <Show
        when={!channelsQuery.isLoading}
        fallback={
          <div class="flex flex-col gap-1">
            <For each={[0, 1, 2]}>
              {() => <div class="h-16 rounded-lg bg-hover" />}
            </For>
          </div>
        }
      >
        <Show
          when={channels().length > 0}
          fallback={
            <div class="rounded-lg p-2.5 text-xs text-ink-muted">
              No recent channels
            </div>
          }
        >
          <div class="flex flex-col gap-1">
            <For each={channels()}>
              {(channel) => (
                <ChannelSummary
                  channel={channel}
                  unreadCount={unreadByChannelId().get(channel.id) ?? 0}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </SideColumnSection>
  );
}

function NotificationsColumnSection() {
  const notificationSource = useGlobalNotificationSource();
  const notifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter(
        (notification) =>
          !notification.done && !notificationIsRead(notification),
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
  );

  return (
    <SideColumnSection
      title="Notifications"
      viewAllLabel="View inbox"
      onViewAll={openInboxView}
    >
      <Show
        when={notifications().length > 0}
        fallback={
          <div class="flex items-center gap-2 rounded-lg p-2.5 text-left">
            <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-muted">
              <BellIcon class="size-3.5" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <p class="text-xs font-medium text-ink">All caught up</p>
              <p class="text-xxs text-ink-muted">No open notifications</p>
            </div>
          </div>
        }
      >
        <DashboardNotificationList
          notifications={notifications()}
          class="max-h-[28rem]"
        />
      </Show>
    </SideColumnSection>
  );
}

function AutomationsColumnSection() {
  const automations = useAutomationEntities();
  const visibleAutomations = createMemo(() =>
    [...automations()]
      .sort((a, b) => {
        if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        const aNext = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Infinity;
        const bNext = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Infinity;
        return aNext - bNext;
      })
      .slice(0, 4),
  );

  return (
    <SideColumnSection
      title="Automations"
      viewAllLabel="View all automations"
      onViewAll={openAutomationsView}
    >
      <Show
        when={visibleAutomations().length > 0}
        fallback={
          <button
            class="flex w-full items-center gap-2 rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
            onClick={() => setAutomationComposerOpen(true, false)}
          >
            <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-muted">
              <RobotIcon class="size-3.5" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <p class="text-xs font-medium text-ink">No automations yet</p>
              <p class="text-xxs text-ink-muted">Create one</p>
            </div>
          </button>
        }
      >
        <div class="flex flex-col gap-1">
          <For each={visibleAutomations()}>
            {(automation) => <AutomationSummary automation={automation} />}
          </For>
        </div>
      </Show>
    </SideColumnSection>
  );
}

export function DashboardSideColumn() {
  return (
    <aside class="hidden min-w-0 flex-col gap-8 pt-8 text-left @6xl/dashboard:flex">
      <AutomationsColumnSection />
      <NotificationsColumnSection />
    </aside>
  );
}
