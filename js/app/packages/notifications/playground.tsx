import { NotificationRenderer } from '@core/component/NotificationRenderer';
import { formatDate } from '@core/util/date';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { PlatformNotificationProvider, usePlatformNotificationState } from './components/PlatformNotificationProvider';
import { createMockWebsocket } from './mock-websocket';
import { notificationWithMetadata } from './notification-metadata';
import { extractNotificationData, NOTIFICATION_LABEL_BY_TYPE, type NotificationData, toBrowserNotification } from './notification-preview';
import { DefaultDocumentNameResolver, DefaultUserNameResolver } from './notification-resolvers';
import { createNotificationSource } from './notification-source';
import type { UnifiedNotification } from './types';

type NotificationsByType = Map<string, UnifiedNotification[]>;

function groupNotificationsByType(notifications: UnifiedNotification[]): NotificationsByType {
  const groups = new Map<string, UnifiedNotification[]>();
  for (const notification of notifications) {
    const type = notification.notificationEventType;
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push(notification);
  }
  return groups;
}

function extractTypedNotificationData(notification: UnifiedNotification): NotificationData | null {
  const typed = notificationWithMetadata(notification);
  if (!typed) return null;
  const data = extractNotificationData(typed);
  if (data === 'no_extractor' || data === 'no_extracted_data') return null;
  return data;
}

function NotificationTypeButton(props: {
  type: string;
  count: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const label = NOTIFICATION_LABEL_BY_TYPE[props.type as keyof typeof NOTIFICATION_LABEL_BY_TYPE] || props.type;

  return (
    <button
      class={`w-full p-4 text-left border-b border-edge-muted transition-all ${
        props.isSelected
          ? 'bg-accent text-ink'
          : 'bg-menu hover:bg-hover'
      }`}
      onClick={props.onSelect}
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <span class={`text-xs font-mono uppercase font-medium ${
            props.isSelected ? 'text-black' : 'text-accent'
          }`}>
            {label}
          </span>
          <span class={`text-xs font-mono truncate ${
            props.isSelected ? 'text-black/70' : 'text-ink-muted'
          }`}>
            {props.type}
          </span>
        </div>
        <span class={`text-sm font-medium shrink-0 ${
          props.isSelected ? 'text-black' : 'text-ink-muted'
        }`}>
          {props.count}
        </span>
      </div>
    </button>
  );
}

function NotificationListItem(props: {
  notification: UnifiedNotification;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const data = () => extractTypedNotificationData(props.notification);
  const isUnread = () => !props.notification.viewedAt;

  return (
    <button
      class={`w-full p-4 text-left border-b border-edge-muted transition-all ${
        props.isSelected ? 'bg-accent/10 border-l-2 border-l-accent' : 'bg-menu hover:bg-hover'
      }`}
      onClick={props.onSelect}
    >
      <div class="flex items-start gap-3">
        <div class={`size-2 mt-1 shrink-0 ${
          isUnread() ? 'bg-accent' : 'bg-ink-extra-muted'
        }`} />
        <div class="flex-1 min-w-0">
          <Show when={data()}>
            <NotificationRenderer notification={props.notification} mode="preview" />
          </Show>
          <div class="text-xs text-ink-muted font-mono mt-2">
            {formatDate(props.notification.createdAt)}
          </div>
        </div>
      </div>
    </button>
  );
}

function BrowserNotificationFormat(props: { notification: UnifiedNotification }) {
  const data = () => extractTypedNotificationData(props.notification);

  return (
    <Show
      when={data()}
      fallback={<div class="text-ink-muted text-sm italic">No extractable data for this notification</div>}
    >
      {(notifData) => {
        const [browserNotif, setBrowserNotif] = createSignal<any>(null);
        toBrowserNotification(notifData(), DefaultUserNameResolver, DefaultDocumentNameResolver)
          .then(setBrowserNotif);

        return (
          <Show
            when={browserNotif()}
            fallback={<div class="text-ink-muted text-sm animate-pulse">Loading browser format...</div>}
          >
            <div class="space-y-4">
              <div>
                <div class="text-xs font-mono text-ink-muted uppercase mb-2">Title</div>
                <div class="bg-menu p-4 rounded-lg border border-edge-muted text-sm text-ink font-medium">
                  {browserNotif()!.title}
                </div>
              </div>
              <div>
                <div class="text-xs font-mono text-ink-muted uppercase mb-2">Description (Body)</div>
                <div class="bg-menu p-4 rounded-lg border border-edge-muted text-sm text-ink">
                  {browserNotif()!.body}
                </div>
              </div>
              <div>
                <div class="text-xs font-mono text-ink-muted uppercase mb-2">Icon</div>
                <div class="bg-menu p-4 rounded-lg border border-edge-muted">
                  <code class="text-xs text-ink-muted">{browserNotif()!.icon}</code>
                </div>
              </div>
              <details class="group">
                <summary class="text-xs font-mono text-ink-muted uppercase cursor-pointer hover:text-accent">
                  Raw JSON ▸
                </summary>
                <pre class="bg-menu p-4 rounded-lg border border-edge-muted text-xs overflow-auto mt-2">
                  {JSON.stringify(browserNotif(), null, 2)}
                </pre>
              </details>
            </div>
          </Show>
        );
      }}
    </Show>
  );
}

function PermissionStatus(props: { platformNotif: any }) {
  return (
    <Show when={props.platformNotif !== 'not-supported'}>
      <div class="mt-4 pt-4 border-t border-edge-muted">
        <Show
          when={props.platformNotif.permission() === 'granted'}
          fallback={
            <button
              class="w-full px-4 py-3 bg-accent text-ink rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
              onClick={() => props.platformNotif.requestPermission()}
            >
              Enable Browser Notifications
            </button>
          }
        >
          <div class="flex items-center gap-3 text-sm text-accent bg-accent/10 px-4 py-3 rounded-lg">
            <div class="size-2 bg-accent rounded-full animate-pulse" />
            <span class="font-medium">Notifications Enabled</span>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function PlaygroundContent() {
  const { ws, emit } = createMockWebsocket();
  const platformNotif = usePlatformNotificationState();

  const notificationSource = createNotificationSource(ws, async (title, opts) => {
    if (platformNotif !== 'not-supported') {
      await platformNotif.showNotification(title, opts);
    }
  });

  const allNotifications = createMemo(() => notificationSource.notifications());
  const notificationsByType = createMemo(() => groupNotificationsByType(allNotifications()));
  const typeEntries = createMemo(() =>
    Array.from(notificationsByType().entries()).sort((a, b) => a[0].localeCompare(b[0]))
  );

  const [selectedType, setSelectedType] = createSignal<string | null>(null);
  const [selectedNotification, setSelectedNotification] = createSignal<UnifiedNotification | null>(null);

  const selectedNotifications = createMemo(() =>
    notificationsByType().get(selectedType() || '') || []
  );

  // Auto-select first notification when type changes
  createEffect(() => {
    const notifications = selectedNotifications();
    if (notifications.length > 0 && selectedType() !== null) {
      setSelectedNotification(notifications[0]);
    }
  });

  const handleSelectType = (type: string) => {
    setSelectedType(type);
  };

  const handleEmitBrowserNotification = async (notification: UnifiedNotification) => {
    if (platformNotif === 'not-supported') return;

    const data = extractTypedNotificationData(notification);
    if (!data) return;

    const browserNotif = await toBrowserNotification(
      data,
      DefaultUserNameResolver,
      DefaultDocumentNameResolver
    );

    if (!browserNotif) return;

    const result = await platformNotif.showNotification(browserNotif.title, browserNotif);

    if (result === 'not-granted' || result === 'disabled-in-ui') {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(browserNotif.title, browserNotif);
      }
    }
  };

  const isLoading = () => notificationSource.isLoading();

  return (
    <Show
      when={!isLoading()}
      fallback={
        <div class="h-screen flex items-center justify-center bg-menu">
          <div class="text-center">
            <div class="text-lg text-ink-muted animate-pulse mb-2">Loading notifications...</div>
            <div class="text-xs text-ink-extra-muted">Fetching from server</div>
          </div>
        </div>
      }
    >
      <div class="h-screen flex bg-menu">
        {/* Type column */}
        <div class="w-80 border-r border-edge-muted bg-menu flex flex-col shrink-0">
          <div class="p-6 border-b border-edge-muted bg-menu sticky top-0">
            <h1 class="text-xl font-semibold text-ink mb-2">Notifications Playground</h1>
            <div class="flex items-center gap-4 text-xs text-ink-muted">
              <span>{allNotifications().length} total</span>
              <span>•</span>
              <span>{typeEntries().length} types</span>
            </div>
            <PermissionStatus platformNotif={platformNotif} />
          </div>

          <div class="flex-1 overflow-auto">
            <For each={typeEntries()}>
              {([type, notifications]) => (
                <NotificationTypeButton
                  type={type}
                  count={notifications.length}
                  isSelected={selectedType() === type}
                  onSelect={() => handleSelectType(type)}
                />
              )}
            </For>
          </div>
        </div>

        {/* Notification list column */}
        <Show
          when={selectedType() !== null}
          fallback={
            <div class="flex-1 flex items-center justify-center text-center p-8">
              <div>
                <h2 class="text-2xl font-medium text-ink mb-3">Select a notification type</h2>
                <p class="text-ink-muted max-w-md">
                  Choose a type from the left sidebar to see all notifications of that type
                </p>
              </div>
            </div>
          }
        >
          <div class="w-96 border-r border-edge-muted bg-menu flex flex-col shrink-0">
            <div class="p-6 border-b border-edge-muted bg-menu sticky top-0">
              <h2 class="text-lg font-semibold text-ink mb-1">
                {NOTIFICATION_LABEL_BY_TYPE[selectedType()! as keyof typeof NOTIFICATION_LABEL_BY_TYPE] || selectedType()}
              </h2>
              <p class="text-xs text-ink-muted">
                {selectedNotifications().length} notification{selectedNotifications().length !== 1 ? 's' : ''}
              </p>
            </div>

            <div class="flex-1 overflow-auto">
              <For each={selectedNotifications()}>
                {(notification) => (
                  <NotificationListItem
                    notification={notification}
                    isSelected={selectedNotification()?.id === notification.id}
                    onSelect={() => setSelectedNotification(notification)}
                  />
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Detail view */}
        <div class="flex-1 overflow-auto bg-menu">
          <Show
            when={selectedNotification()}
            fallback={
              <div class="h-full flex items-center justify-center text-center p-8">
                <div>
                  <h2 class="text-2xl font-medium text-ink mb-3">Select a notification</h2>
                  <p class="text-ink-muted max-w-md">
                    Choose a notification from the list to see detailed rendering and format information
                  </p>
                </div>
              </div>
            }
          >
            {(notification) => (
              <div class="p-8 max-w-4xl mx-auto">
                {/* Header */}
                <div class="mb-8 pb-6 border-b border-edge-muted">
                  <div class="flex items-start justify-between gap-4 mb-4">
                    <div class="flex-1">
                      <h2 class="text-3xl font-semibold text-ink mb-2">
                        {NOTIFICATION_LABEL_BY_TYPE[notification().notificationEventType as keyof typeof NOTIFICATION_LABEL_BY_TYPE] || notification().notificationEventType}
                      </h2>
                      <p class="text-sm text-ink-muted">
                        {formatDate(notification().createdAt)}
                      </p>
                    </div>
                    <button
                      class="px-4 py-2 bg-accent text-ink rounded-lg hover:bg-accent-hover transition-colors text-sm font-medium shadow-sm"
                      onClick={() => handleEmitBrowserNotification(notification())}
                    >
                      Test Browser Notification
                    </button>
                  </div>
                </div>

                {/* Preview Mode */}
                <section class="mb-10">
                  <h3 class="text-lg font-semibold text-ink mb-4">Preview Mode</h3>
                  <div class="p-4 bg-menu rounded-xl border border-edge-muted">
                    <div class="flex items-start gap-3">
                      <div class={`size-2 mt-1 shrink-0 rounded-full ${
                        !notification().viewedAt ? 'bg-accent' : 'bg-ink-extra-muted'
                      }`} />
                      <div class="flex-1 min-w-0">
                        <NotificationRenderer notification={notification()} mode="preview" />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Full Mode */}
                <section class="mb-10">
                  <h3 class="text-lg font-semibold text-ink mb-4">Full Mode</h3>
                  <div class={`p-6 rounded-xl border border-edge-muted ${
                    !notification().viewedAt ? 'bg-menu-hover' : 'bg-menu'
                  }`}>
                    <div class="flex justify-start items-center gap-3 mb-4 font-mono text-ink-muted text-xs uppercase">
                      <div class={`size-2 rounded-full ${
                        !notification().viewedAt ? 'bg-accent' : 'bg-ink-extra-muted'
                      }`} />
                      <div class="font-medium">
                        {NOTIFICATION_LABEL_BY_TYPE[notification().notificationEventType as keyof typeof NOTIFICATION_LABEL_BY_TYPE]}
                      </div>
                      <div class="grow" />
                      <div>{formatDate(notification().createdAt)}</div>
                    </div>
                    <div class="ml-5">
                      <NotificationRenderer notification={notification()} mode="full" />
                    </div>
                  </div>
                </section>

                {/* Browser Notification Format */}
                <section class="mb-10">
                  <h3 class="text-lg font-semibold text-ink mb-4">Browser Notification Format</h3>
                  <BrowserNotificationFormat notification={notification()} />
                </section>

                <section>
                  <details class="group">
                    <summary class="text-lg font-semibold text-ink mb-4 cursor-pointer hover:text-accent">
                      Raw Notification Data ▸
                    </summary>
                    <pre class="bg-menu p-6 rounded-xl border border-edge-muted text-xs overflow-auto mt-4">
                      {JSON.stringify(notification(), null, 2)}
                    </pre>
                  </details>
                </section>
              </div>
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}

export function NotificationsPlayground() {
  return (
    <PlatformNotificationProvider>
      <PlaygroundContent />
    </PlatformNotificationProvider>
  );
}
