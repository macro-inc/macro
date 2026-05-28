import { useGlobalNotificationSource } from "@app/component/GlobalAppState";
import { globalSplitManager } from "@app/signal/splitLayout";
import { setAutomationComposerOpen } from "@block-automation/component";
import {
  EntityIcon,
  type EntityIconSelector,
} from "@core/component/EntityIcon";
import { tryMacroId, useDisplayName } from "@core/user";
import type { AutomationEntity } from "@entity";
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

function notificationIconType(
  notification: UnifiedNotification,
): EntityIconSelector {
  if (notification.notification_metadata.tag === "task_assigned") return "task";
  if (notification.notification_metadata.tag === "ai_response") {
    return notification.entity_type === "automation" ? "automation" : "chat";
  }
  if (notification.entity_type === "email_thread") return "email";
  if (notification.entity_type === "channel_message") return "channel";
  if (notification.entity_type === "document") return "md";
  return notification.entity_type as EntityIconSelector;
}

function metadataContent(notification: UnifiedNotification) {
  return (
    notification.notification_metadata as { content?: Record<string, unknown> }
  ).content;
}

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
  const content = () => getNotificationContent(props.notification);
  const tag = () => props.notification.notification_metadata.tag;
  const title = () => {
    if (tag() === "new_email") return actor();
    return actor();
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
      <div class="flex items-start gap-2 pr-3">
        <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hover transition group-hover:bg-active">
          <EntityIcon
            targetType={notificationIconType(props.notification)}
            size="sm"
            class="shrink-0"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <Show
              when={tag() === "task_assigned"}
              fallback={
                <p class="truncate text-xs font-semibold text-ink">{title()}</p>
              }
            >
              <p class="flex min-w-0 items-center gap-1.5 truncate text-xs">
                <span class="truncate font-semibold text-ink">{actor()}</span>
                <span class="shrink-0 font-medium text-ink-extra-muted">
                  {getNotificationAction(props.notification)}
                </span>
              </p>
            </Show>
            <Show
              when={
                tag() !== "new_email" && tag() !== "task_assigned" && target()
              }
            >
              {(name) => (
                <p class="truncate text-xs font-medium text-ink">{name()}</p>
              )}
            </Show>
          </div>
          <Show when={tag() !== "new_email" && tag() !== "task_assigned"}>
            <p class="truncate text-xxs text-ink-extra-muted">
              {getNotificationAction(props.notification)}
            </p>
          </Show>
          <Show when={description()}>
            {(text) => (
              <p class="line-clamp-2 text-xs/5 text-ink-muted">{text()}</p>
            )}
          </Show>
        </div>
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
