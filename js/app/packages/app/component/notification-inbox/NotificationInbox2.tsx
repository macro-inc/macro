import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import type { UnifiedNotification } from '@notifications';
import FunnelIcon from '@phosphor/funnel.svg';
import SortAscendingIcon from '@phosphor/sort-ascending.svg';
import StackIcon from '@phosphor/stack.svg';
import EyeIcon from '@phosphor-icons/core/regular/eye.svg?component-solid';
import { Button } from '@ui';
import { createEffect, createSignal, For, Match, Show, Switch } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { NotificationListEntity } from './NotificationListEntity';

const getNotificationTime = (notification: UnifiedNotification): number => {
  const time = Date.parse(
    notification.created_at ?? notification.updated_at ?? ''
  );
  return Number.isNaN(time) ? 0 : time;
};

const sortNotifications = (
  notifications: UnifiedNotification[]
): UnifiedNotification[] =>
  notifications.toSorted(
    (a, b) => getNotificationTime(b) - getNotificationTime(a)
  );

function NotificationInboxItems(props: {
  notifications: UnifiedNotification[];
  listEntityLayout?: 'compact' | 'multirow';
}) {
  return (
    <div class="unified-table-body w-full flex flex-col gap-1 flex-1 min-h-0 relative overflow-y-auto p-2">
      <For each={props.notifications}>
        {(notification) => (
          <NotificationListEntity
            notification={notification}
            layout={props.listEntityLayout}
          />
        )}
      </For>
    </div>
  );
}

function NotificationInboxListLayout(props: {
  notifications: UnifiedNotification[];
  isLoading: boolean;
  listEntityLayout?: 'compact' | 'multirow';
}) {
  return (
    <div class="@container/u-list size-full min-h-0 unified-list-root flex flex-col">
      <Show when={!props.isLoading} fallback={<LoadingBlock />}>
        <Show
          when={props.notifications.length > 0}
          fallback={
            <div class="flex size-full items-center justify-center text-sm text-ink-muted">
              No notifications
            </div>
          }
        >
          <NotificationInboxItems
            notifications={props.notifications}
            listEntityLayout={props.listEntityLayout}
          />
        </Show>
      </Show>
    </div>
  );
}

function NotificationInboxPreviewLayout(props: {
  notifications: UnifiedNotification[];
  isLoading: boolean;
}) {
  return (
    <div class="grid size-full min-h-0 grid-cols-[minmax(22rem,0.42fr)_minmax(0,1fr)] overflow-hidden">
      <div class="min-w-0 min-h-0 border-r border-edge-muted">
        <NotificationInboxListLayout
          notifications={props.notifications}
          isLoading={props.isLoading}
          listEntityLayout="multirow"
        />
      </div>
      <div class="min-w-0 bg-surface/50 p-4">
        <div class="flex size-full items-center justify-center rounded-lg border border-dashed border-edge-muted text-sm text-ink-extra-muted">
          Preview
        </div>
      </div>
    </div>
  );
}

export function NotificationInbox2() {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const [layout, setLayout] = createSignal<'list' | 'preview'>('preview');

  createEffect(() => {
    panel.handle.setDisplayName('Inbox 2');
  });

  const [notifications, setNotifications] = createStore<UnifiedNotification[]>(
    []
  );

  createEffect(() => {
    const next = sortNotifications(
      notificationSource
        .notifications()
        .filter((notification) => !notification.deleted_at)
    );

    setNotifications(reconcile(next, { key: 'id' }));
  });

  return (
    <div class="size-full flex flex-col" data-list-view="inbox2">
      <div class="flex flex-col w-full">
        <SplitHeaderLeft>
          <div class="h-full flex gap-3 items-center shrink-0">
            <span class="text-base font-bold">Inbox 2</span>
          </div>
        </SplitHeaderLeft>
        <SplitToolbarLeft>
          <div class="flex items-start gap-1 min-w-0 flex-1">
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
              disabled
            >
              <SortAscendingIcon class="size-3.5" />
              <span>Sort</span>
            </Button>
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
              disabled
            >
              <StackIcon class="size-3.5" />
              <span>Group</span>
            </Button>
            <Button
              variant="base"
              size="sm"
              depth={2}
              class="bg-surface"
              disabled
            >
              <FunnelIcon class="size-3.5" />
              <span>Filter</span>
            </Button>
          </div>
        </SplitToolbarLeft>
        <SplitToolbarRight>
          <Button
            variant={layout() === 'preview' ? 'active' : 'base'}
            size="sm"
            depth={2}
            class="bg-surface"
            onClick={() =>
              setLayout((value) => (value === 'preview' ? 'list' : 'preview'))
            }
          >
            <EyeIcon class="size-3.5" />
            <span>{layout() === 'preview' ? 'List' : 'Preview'}</span>
          </Button>
        </SplitToolbarRight>
      </div>

      <div class="relative grow min-h-1 size-full">
        <Switch>
          <Match when={layout() === 'preview'}>
            <NotificationInboxPreviewLayout
              notifications={notifications}
              isLoading={notificationSource.isLoading()}
            />
          </Match>
          <Match when={true}>
            <NotificationInboxListLayout
              notifications={notifications}
              isLoading={notificationSource.isLoading()}
            />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
