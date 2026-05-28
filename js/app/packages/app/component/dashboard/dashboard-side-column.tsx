import { useGlobalNotificationSource } from "@app/component/GlobalAppState";
import { globalSplitManager } from "@app/signal/splitLayout";
import { setAutomationComposerOpen } from "@block-automation/component";
import { StaticMarkdown } from "@core/component/LexicalMarkdown/component/core/StaticMarkdown";
import { UserIcon } from "@core/component/UserIcon";
import {
  createTheme,
  theme as markdownTheme,
} from "@core/component/LexicalMarkdown/theme";
import { tryMacroId, useDisplayName } from "@core/user";
import type { AutomationEntity } from "@entity";
import { Entity } from "@entity";
import { formatDateAndTime } from "@entity/utils/timestamp";
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  notificationIsRead,
  openNotification,
} from "@notifications";
import type { UnifiedNotification } from "@notifications/types";
import { useAutomationEntities } from "@queries/agent-schedule/entities";
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
        <div class="group/header relative flex w-full items-center gap-2.5 px-2 py-2 text-xs font-semibold tracking-tight text-text-muted">
          <button
            class="peer/collapse absolute inset-0 rounded-lg border border-transparent bg-transparent transition hover:border-edge-muted hover:bg-surface focus:outline-none focus-visible:border-edge-muted focus-visible:bg-surface"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed()}
            aria-label={`${collapsed() ? "Expand" : "Collapse"} ${props.title}`}
          />
          <div class="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5">
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

function metadataContent(notification: UnifiedNotification) {
  return (
    notification.notification_metadata as { content?: Record<string, unknown> }
  ).content;
}

const compactMarkdownTheme = createTheme(
  {
    paragraph: "m-0 md-p text-[1em]",
    list: {
      listitem: "m-0",
    },
  },
  markdownTheme,
);

function NotificationSummary(props: { notification: UnifiedNotification }) {
  const notificationSource = useGlobalNotificationSource();
  const actorId = () => props.notification.sender_id ?? "";
  const macroId = () => tryMacroId(actorId());
  const [actorName] = useDisplayName(macroId());
  const actor = () => {
    const content = metadataContent(props.notification);
    return (
      actorName() ||
      (content?.senderName as string | undefined) ||
      (content?.fromName as string | undefined) ||
      (content?.from as string | undefined) ||
      (content?.senderEmail as string | undefined) ||
      "Someone"
    );
  };
  const unread = () => !notificationIsRead(props.notification);
  const target = () => getNotificationTargetName(props.notification);
  const notificationContent = () => metadataContent(props.notification);
  const channelName = () =>
    notificationContent()?.channelName as string | undefined;
  const isDirectMessage = () =>
    notificationContent()?.channelType === "directMessage";
  const content = () => getNotificationContent(props.notification);
  const tag = () => props.notification.notification_metadata.tag;
  const action = () => getNotificationAction(props.notification).replace(/\s+in$/, "");
  const title = () => {
    if (tag() === "new_email" || isDirectMessage()) return actor();
    return channelName() || actor();
  };
  const description = () => {
    if (tag() === "new_email") return content();
    if (tag() === "task_assigned") return target() || content();
    return content();
  };

  const open = () => {
    const manager = globalSplitManager();
    if (!manager) return;
    void openNotification(props.notification, manager, false);
    if (unread()) void notificationSource.markAsRead(props.notification);
  };

  return (
    <button
      class="group relative w-full rounded-lg p-2.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={open}
    >
      <Show when={unread()}>
        <span class="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-accent" />
      </Show>
      <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 pr-3">
        <Show
          when={isDirectMessage() && actorId()}
          fallback={
            <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover transition group-hover:bg-active">
              <Entity.Notification.Icon
                notification={props.notification as any}
                class="shrink-0"
              />
            </div>
          }
        >
          {(id) => (
            <UserIcon
              id={id()}
              size="md"
              suppressClick
              showTooltip={false}
            />
          )}
        </Show>

        <div class="flex min-w-0 items-center gap-1.5">
          <Show
            when={tag() === "task_assigned"}
            fallback={
              <p class="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-ink">
                <span class="truncate">{title()}</span>
              </p>
            }
          >
            <p class="flex min-w-0 items-center gap-1.5 truncate text-xs">
              <span class="truncate font-semibold text-ink">{actor()}</span>
              <span class="shrink-0 font-medium text-ink-extra-muted">
                {action()}
              </span>
            </p>
          </Show>
        </div>

        <Show when={description()}>
          {(markdown) => (
            <div class="col-start-2 flex min-w-0 items-start gap-1.5 text-xs/5 text-ink-muted [&_*]:text-xs [&_*]:leading-5">
              <Show when={channelName() && !isDirectMessage() && actorId()}>
                {(id) => (
                  <span class="inline-flex shrink-0 items-center gap-1 font-medium text-ink-muted">
                    <UserIcon
                      id={id()}
                      size="xs"
                      suppressClick
                      showTooltip={false}
                    />
                    <span>{actor()}</span>
                  </span>
                )}
              </Show>
              <div class="line-clamp-2 min-w-0">
                <StaticMarkdown
                  markdown={markdown()}
                  theme={compactMarkdownTheme}
                />
              </div>
            </div>
          )}
        </Show>
      </div>
    </button>
  );
}

function NotificationsColumnSection() {
  const notificationSource = useGlobalNotificationSource();
  const notifications = createMemo(() =>
    notificationSource
      .notifications()
      .filter((notification) => !notification.done)
      .sort(
        (a, b) =>
          Number(!notificationIsRead(b)) - Number(!notificationIsRead(a)) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, 4),
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
        <div class="flex flex-col gap-1">
          <For each={notifications()}>
            {(notification) => (
              <NotificationSummary notification={notification} />
            )}
          </For>
        </div>
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
