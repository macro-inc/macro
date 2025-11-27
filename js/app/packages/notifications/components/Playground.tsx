import { useChannelMarkdownArea } from '@block-channel/component/MarkdownArea';
import { NotificationRenderer } from '@core/component/NotificationRenderer';
import { TextButton } from '@core/component/TextButton';
import { formatDate } from '@core/util/date';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
} from 'solid-js';
import { notificationWithMetadata } from '../notification-metadata';
import {
  extractNotificationData,
  NOTIFICATION_LABEL_BY_TYPE,
  type NotificationData,
} from '../notification-preview';
import {
  maybeHandlePlatformNotification,
  PlatformNotificationData,
  toPlatformNotificationData,
} from '../notification-platform';
import {
  DefaultDocumentNameResolver,
  DefaultUserNameResolver,
} from '../notification-resolvers';
import { createNotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';
import { createMockWebsocket } from '../utils/mock-websocket';
import {
  PlatformNotificationProvider,
  PlatformNotificationState,
  usePlatformNotificationState,
} from './PlatformNotificationProvider';
import { globalSplitManager } from '@app/signal/splitLayout';

type NotificationsByType = Map<string, UnifiedNotification[]>;

function groupNotificationsByType(
  notifications: UnifiedNotification[]
): NotificationsByType {
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

function extractTypedNotificationData(
  notification: UnifiedNotification
): NotificationData | null {
  const typed = notificationWithMetadata(notification);
  if (!typed) return null;
  const data = extractNotificationData(typed);
  if (data === 'no_extractor' || data === 'no_extracted_data') return null;
  return data;
}

function TypeButton(props: {
  type: string;
  count: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const label =
    NOTIFICATION_LABEL_BY_TYPE[
      props.type as keyof typeof NOTIFICATION_LABEL_BY_TYPE
    ] || props.type;

  return (
    <button
      class={`w-full p-4 text-left border-b border-edge-muted transition-all ${
        props.isSelected ? 'bg-accent text-ink' : 'bg-menu hover:bg-hover'
      }`}
      onClick={props.onSelect}
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <span
            class={`text-xs font-mono uppercase font-medium ${
              props.isSelected ? 'text-black' : 'text-accent'
            }`}
          >
            {label}
          </span>
          <span
            class={`text-xs font-mono truncate ${
              props.isSelected ? 'text-black/70' : 'text-ink-muted'
            }`}
          >
            {props.type}
          </span>
        </div>
        <span
          class={`text-sm font-medium shrink-0 ${
            props.isSelected ? 'text-black' : 'text-ink-muted'
          }`}
        >
          {props.count}
        </span>
      </div>
    </button>
  );
}

function NotificationItem(props: {
  notification: UnifiedNotification;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const data = () => extractTypedNotificationData(props.notification);
  const isUnread = () => !props.notification.viewedAt;

  return (
    <button
      class={`w-full p-4 text-left border-b border-edge-muted transition-all ${
        props.isSelected
          ? 'bg-accent/10 border-l-2 border-l-accent'
          : 'bg-menu hover:bg-hover'
      }`}
      onClick={props.onSelect}
    >
      <div class="flex items-start gap-3">
        <div
          class={`size-2 mt-1 shrink-0 ${
            isUnread() ? 'bg-accent' : 'bg-ink-extra-muted'
          }`}
        />
        <div class="flex-1 min-w-0">
          <Show when={data()}>
            <NotificationRenderer
              notification={props.notification}
              mode="preview"
            />
          </Show>
          <div class="text-xs text-ink-muted font-mono mt-2">
            {formatDate(props.notification.createdAt)}
          </div>
        </div>
      </div>
    </button>
  );
}

function BrowserFormat(props: { notification: UnifiedNotification }) {
  const data = createMemo(() =>
    extractTypedNotificationData(props.notification)
  );
  const [browserNotif, setBrowserNotif] = createSignal<any>(null);

  createEffect(() => {
    const notifData = data();
    if (notifData) {
      toPlatformNotificationData(
        notifData,
        DefaultUserNameResolver,
        DefaultDocumentNameResolver
      ).then(setBrowserNotif);
    } else {
      setBrowserNotif(null);
    }
  });

  return (
    <Show
      when={data()}
      fallback={
        <div class="text-ink-muted text-sm italic">No extractable data</div>
      }
    >
      <Show
        when={browserNotif()}
        fallback={
          <div class="text-ink-muted text-sm animate-pulse">Loading...</div>
        }
      >
        <div class="space-y-6">
          <div>
            <div class="text-xs font-mono text-ink-muted uppercase mb-3">
              Visual Preview
            </div>
            <BrowserNotificationPreview
              title={browserNotif()!.title}
              body={browserNotif()!.body}
              icon={browserNotif()!.icon}
            />
          </div>

          <div class="pt-4 border-t border-edge-muted space-y-4">
            <div>
              <div class="text-xs font-mono text-ink-muted uppercase mb-2">
                Title
              </div>
              <div class="bg-menu p-4 rounded-lg border border-edge-muted text-sm text-ink font-medium">
                {browserNotif()!.title}
              </div>
            </div>
            <div>
              <div class="text-xs font-mono text-ink-muted uppercase mb-2">
                Description (Body)
              </div>
              <div class="bg-menu p-4 rounded-lg border border-edge-muted text-sm text-ink">
                {browserNotif()!.body || (
                  <span class="italic text-ink-muted">(empty)</span>
                )}
              </div>
            </div>
            <div>
              <div class="text-xs font-mono text-ink-muted uppercase mb-2">
                Icon
              </div>
              <div class="bg-menu p-4 rounded-lg border border-edge-muted">
                <code class="text-xs text-ink-muted">
                  {browserNotif()!.icon}
                </code>
              </div>
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
    </Show>
  );
}

function PermissionButton(props: { platformNotif: any }) {
  return (
    <Show when={props.platformNotif !== 'not-supported'}>
      <div class="mt-4 pt-4 border-t border-edge-muted">
        <Show
          when={props.platformNotif.permission() === 'granted'}
          fallback={
            <TextButton
              theme="accent"
              text="Enable Browser Notifications"
              onClick={() => props.platformNotif.requestPermission()}
            />
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

function CustomBuilder(props: {
  markdownArea: ReturnType<typeof useChannelMarkdownArea>;
  customNotification: UnifiedNotification;
  onTest: (notification: UnifiedNotification) => void;
}) {
  return (
    <div class="w-96 border-r border-edge-muted bg-menu flex flex-col shrink-0">
      <div class="p-6 border-b border-edge-muted bg-menu sticky top-0">
        <h2 class="text-lg font-semibold text-ink mb-1">
          Custom Message Builder
        </h2>
        <p class="text-xs text-ink-muted">Test markdown rendering</p>
      </div>

      <div class="flex-1 overflow-auto p-6 space-y-6">
        <div>
          <label class="block text-sm font-medium text-ink mb-3">
            Message Content
          </label>
          <div class="border border-edge-muted rounded-lg p-3 bg-menu min-h-64 max-h-96 overflow-auto">
            <props.markdownArea.MarkdownArea
              placeholder="Type your markdown message here... (use @ for mentions)"
              initialValue="Hey! Check out this **cool feature** we just shipped.\n\nHere's a code example:\n```typescript\nconst notify = () => {\n  console.log('Hello!');\n};\n```\n\nLet me know what you think!"
              users={() => []}
              history={() => []}
            />
          </div>
          <p class="text-xs text-ink-muted mt-2">
            Full markdown editor with syntax highlighting, code blocks, and
            formatting
          </p>
        </div>

        <div class="pt-4 border-t border-edge-muted">
          <TextButton
            theme="accent"
            text="🔔 Test Browser Notification"
            onClick={() => props.onTest(props.customNotification)}
          />
        </div>

        <div>
          <h3 class="text-sm font-medium text-ink mb-3">Live Preview</h3>
          <div class="p-4 bg-menu-hover rounded-lg border border-edge-muted">
            <NotificationRenderer
              notification={props.customNotification}
              mode="preview"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationList(props: {
  type: string;
  notifications: UnifiedNotification[];
  selectedId: string | undefined;
  onSelect: (notification: UnifiedNotification) => void;
}) {
  return (
    <div class="w-96 border-r border-edge-muted bg-menu flex flex-col shrink-0">
      <div class="p-6 border-b border-edge-muted bg-menu sticky top-0">
        <h2 class="text-lg font-semibold text-ink mb-1">
          {NOTIFICATION_LABEL_BY_TYPE[
            props.type as keyof typeof NOTIFICATION_LABEL_BY_TYPE
          ] || props.type}
        </h2>
        <p class="text-xs text-ink-muted">
          {props.notifications.length} notification
          {props.notifications.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div class="flex-1 overflow-auto">
        <For each={props.notifications}>
          {(notification) => (
            <NotificationItem
              notification={notification}
              isSelected={props.selectedId === notification.id}
              onSelect={() => props.onSelect(notification)}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function NotificationDetail(props: {
  notification: UnifiedNotification;
  onTest: (notification: UnifiedNotification) => void;
}) {
  return (
    <div class="p-8 max-w-4xl mx-auto">
      <div class="mb-8 pb-6 border-b border-edge-muted">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div class="flex-1">
            <h2 class="text-3xl font-semibold text-ink mb-2">
              {NOTIFICATION_LABEL_BY_TYPE[
                props.notification
                  .notificationEventType as keyof typeof NOTIFICATION_LABEL_BY_TYPE
              ] || props.notification.notificationEventType}
            </h2>
            <p class="text-sm text-ink-muted">
              {formatDate(props.notification.createdAt)}
            </p>
          </div>
          <TextButton
            theme="accent"
            text="🔔 Test Notification"
            onClick={() => props.onTest(props.notification)}
          />
        </div>
      </div>

      <section class="mb-10">
        <h3 class="text-lg font-semibold text-ink mb-4">Preview Mode</h3>
        <div class="p-4 bg-menu rounded-xl border border-edge-muted">
          <div class="flex items-start gap-3">
            <div
              class={`size-2 mt-1 shrink-0  ${
                !props.notification.viewedAt
                  ? 'bg-accent'
                  : 'bg-ink-extra-muted'
              }`}
            />
            <div class="flex-1 min-w-0">
              <NotificationRenderer
                notification={props.notification}
                mode="preview"
              />
            </div>
          </div>
        </div>
      </section>

      <section class="mb-10">
        <h3 class="text-lg font-semibold text-ink mb-4">Full Mode</h3>
        <div
          class={`p-6 rounded-xl border border-edge-muted ${
            !props.notification.viewedAt ? 'bg-menu-hover' : 'bg-menu'
          }`}
        >
          <div class="flex justify-start items-center gap-3 mb-4 font-mono text-ink-muted text-xs uppercase">
            <div
              class={`size-2 ${
                !props.notification.viewedAt
                  ? 'bg-accent'
                  : 'bg-ink-extra-muted'
              }`}
            />
            <div class="font-medium">
              {
                NOTIFICATION_LABEL_BY_TYPE[
                  props.notification
                    .notificationEventType as keyof typeof NOTIFICATION_LABEL_BY_TYPE
                ]
              }
            </div>
            <div class="grow" />
            <div>{formatDate(props.notification.createdAt)}</div>
          </div>
          <div class="ml-5">
            <NotificationRenderer
              notification={props.notification}
              mode="full"
            />
          </div>
        </div>
      </section>

      <section class="mb-10">
        <h3 class="text-lg font-semibold text-ink mb-4">
          Browser Notification Format
        </h3>
        <BrowserFormat notification={props.notification} />
      </section>

      <section>
        <details class="group">
          <summary class="text-lg font-semibold text-ink mb-4 cursor-pointer hover:text-accent">
            Raw Notification Data ▸
          </summary>
          <pre class="bg-menu p-6 rounded-xl border border-edge-muted text-xs overflow-auto mt-4">
            {JSON.stringify(props.notification, null, 2)}
          </pre>
        </details>
      </section>
    </div>
  );
}

function EmptyState(props: { title: string; description: string }) {
  return (
    <div class="h-full flex items-center justify-center text-center p-8">
      <div>
        <h2 class="text-2xl font-medium text-ink mb-3">{props.title}</h2>
        <p class="text-ink-muted max-w-md">{props.description}</p>
      </div>
    </div>
  );
}

function PlaygroundContent() {
  const { ws } = createMockWebsocket();
  const platformNotif = usePlatformNotificationState();
  const markdownArea = useChannelMarkdownArea();

  const notificationSource = createNotificationSource(ws);

  const allNotifications = createMemo(() => notificationSource.notifications());
  const notificationsByType = createMemo(() =>
    groupNotificationsByType(allNotifications())
  );
  const typeEntries = createMemo(() =>
    Array.from(notificationsByType().entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    )
  );

  const [selectedType, setSelectedType] = createSignal<string | null>(null);
  const [selectedNotification, setSelectedNotification] =
    createSignal<UnifiedNotification | null>(null);
  const [customMode, setCustomMode] = createSignal(false);

  const selectedNotifications = createMemo(
    () => notificationsByType().get(selectedType() || '') || []
  );

  const customNotification = createMemo((): UnifiedNotification => {
    /** @ts-ignore */
    return {
      id: `custom-${Date.now()}`,
      createdAt: Math.floor(Date.now() / 1000),
      eventItemId: 'channel-custom',
      eventItemType: 'channel',
      senderId: 'user-custom',
      notificationEventType: 'channel_message_send',
      notificationMetadata: {
        sender: 'user-custom',
        messageContent: markdownArea.state(),
        messageId: 'msg-custom',
        channelType: 'direct_message',
        channelName: 'test-channel',
      },
      viewedAt: null,
      done: false,
    } as UnifiedNotification;
  });

  createEffect(() => {
    const notifications = selectedNotifications();
    if (notifications.length > 0 && selectedType() !== null && !customMode()) {
      setSelectedNotification(notifications[0]);
    }
  });

  createEffect(() => {
    if (customMode()) {
      setSelectedNotification(customNotification());
    }
  });

  const handleSelectType = (type: string) => {
    setSelectedType(type);
    setCustomMode(false);
  };

  const handleTestNotification = async (notification: UnifiedNotification) => {
    if (platformNotif === 'not-supported') return;

    console.log('test notification', notification);
    const onNotification = (notification: UnifiedNotification) => {
      const layoutManager = globalSplitManager();
      if (!layoutManager) {
        console.warn('no layout manager');
        return;
      }
      maybeHandlePlatformNotification(
        notification,
        {
          showNotification: async (data: PlatformNotificationData) => {
            const notif = new Notification(data.title, data.options);
            return {
              onClick: (cb: any) => {
                notif.addEventListener('click', cb);
              },
              close: () => {
                notif.close();
              },
            };
          },
        } as PlatformNotificationState,
        layoutManager
      );
    };

    onNotification(notification);
  };

  const isLoading = () => notificationSource.isLoading();

  return (
    <Show
      when={!isLoading()}
      fallback={
        <div class="h-screen flex items-center justify-center bg-menu">
          <div class="text-center">
            <div class="text-lg text-ink-muted animate-pulse mb-2">
              Loading notifications...
            </div>
            <div class="text-xs text-ink-extra-muted">Fetching from server</div>
          </div>
        </div>
      }
    >
      <div class="h-screen flex bg-menu">
        {/* Type selector sidebar */}
        <div class="w-80 border-r border-edge-muted bg-menu flex flex-col shrink-0">
          <div class="p-6 border-b border-edge-muted bg-menu sticky top-0">
            <h1 class="text-xl font-semibold text-ink mb-2">
              Notifications Playground
            </h1>
            <div class="flex items-center gap-4 text-xs text-ink-muted">
              <span>{allNotifications().length} total</span>
              <span>•</span>
              <span>{typeEntries().length} types</span>
            </div>
            <PermissionButton platformNotif={platformNotif} />
          </div>

          <div class="border-b border-edge-muted">
            <button
              class={`w-full p-4 text-left transition-all ${
                customMode() ? 'bg-accent text-ink' : 'bg-menu hover:bg-hover'
              }`}
              onClick={() => {
                setCustomMode(true);
                setSelectedType(null);
                setSelectedNotification(customNotification());
              }}
            >
              <div class="flex items-center justify-between">
                <span
                  class={`text-sm font-medium ${customMode() ? 'text-black' : 'text-accent'}`}
                >
                  Custom Message Test
                </span>
                <span
                  class={`text-xs ${customMode() ? 'text-black/70' : 'text-ink-muted'}`}
                >
                  Builder
                </span>
              </div>
            </button>
          </div>

          <div class="flex-1 overflow-auto">
            <For each={typeEntries()}>
              {([type, notifications]) => (
                <TypeButton
                  type={type}
                  count={notifications.length}
                  isSelected={selectedType() === type}
                  onSelect={() => handleSelectType(type)}
                />
              )}
            </For>
          </div>
        </div>

        {/* Middle column: custom builder or notification list */}
        <Show
          when={customMode()}
          fallback={
            <Show
              when={selectedType() !== null}
              fallback={
                <EmptyState
                  title="Select a notification type"
                  description="Choose a type from the left sidebar to see all notifications of that type"
                />
              }
            >
              <NotificationList
                type={selectedType()!}
                notifications={selectedNotifications()}
                selectedId={selectedNotification()?.id}
                onSelect={setSelectedNotification}
              />
            </Show>
          }
        >
          <CustomBuilder
            markdownArea={markdownArea}
            customNotification={customNotification()}
            onTest={handleTestNotification}
          />
        </Show>

        {/* Detail view */}
        <div class="flex-1 overflow-auto bg-menu">
          <Show
            when={selectedNotification()}
            fallback={
              <EmptyState
                title="Select a notification"
                description="Choose a notification from the list to see detailed rendering and format information"
              />
            }
          >
            {(notification) => (
              <NotificationDetail
                notification={notification()}
                onTest={handleTestNotification}
              />
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

interface NotificationProps {
  icon?: string;
  title: string;
  body: string;
  badge?: string;
  onClose?: () => void;
}

export const BrowserNotificationPreview: Component<NotificationProps> = (
  props
) => {
  return (
    <div class="w-full bg-[#1a1a1a] rounded-lg shadow-2xl overflow-hidden">
      <div class="flex items-start gap-3 p-4">
        {/* Icon with optional badge */}
        <div class="relative flex-shrink-0">
          <div class="w-10 h-10 rounded-lg overflow-hidden bg-gray-800 flex items-center justify-center">
            <Show
              when={props.icon}
              fallback={<div class="w-6 h-6 bg-gray-600 rounded" />}
            >
              <img src={props.icon} alt="" class="w-full h-full object-cover" />
            </Show>
          </div>
          <Show when={props.badge}>
            <div class="absolute -top-1 -left-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
              <img src={props.badge} alt="" class="w-3 h-3" />
            </div>
          </Show>
        </div>

        {/* Content */}
        <div class="flex-1 min-w-0">
          <div class="text-white font-medium text-sm mb-1 truncate">
            {props.title}
          </div>
          <div class="text-gray-400 text-sm line-clamp-2">{props.body}</div>
        </div>

        {/* Close button */}
        <button
          onClick={props.onClose}
          class="flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};
