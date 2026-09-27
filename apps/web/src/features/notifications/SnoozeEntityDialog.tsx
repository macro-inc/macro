import { useQuickAccess } from '@core/context/quickAccess';
import { debouncedDependent } from '@core/util/debounce';
import { muteItemForEntity } from '@entity/utils/notification';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import {
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
} from '@ui';
import { createSignal, Suspense } from 'solid-js';
import { SnoozeEntityPicker } from './components/SnoozeEntityPicker';
import { mutedEntityTypeLabel } from './notification-event-catalog';
import { useSnoozeEmails } from './queries/snooze-emails';
import { openSnoozeNotifications } from './SnoozeNotificationsDialog';

function SnoozeEntityDialog(
  props: ManagedDialogProps & { onSelectItem: (item: UserUnsubscribe) => void }
) {
  const [query, setQuery] = createSignal('');
  const searchTerm = debouncedDependent(query, 100);
  const list = useQuickAccess().useList({
    buckets: [
      'channel',
      'dm',
      'document',
      'note',
      'task',
      'snippet',
      'chat',
      'project',
    ],
    searchTerm,
    enabled: () => props.open,
  });
  const emails = useSnoozeEmails(searchTerm, () => props.open);
  const entities = () => [
    ...list.items().map((entry) => entry.data),
    ...emails.items(),
  ];
  const items = () =>
    entities().flatMap((entity) => {
      const item = muteItemForEntity(entity);
      return item
        ? [
            {
              id: entity.id,
              name: entity.name,
              type: mutedEntityTypeLabel(item.item_type),
            },
          ]
        : [];
    });
  return (
    <Suspense fallback={<div role="status">Loading items…</div>}>
      <SnoozeEntityPicker
        {...props}
        query={query()}
        onQueryChange={setQuery}
        items={items()}
        loading={list.isLoading() || list.isLoadingMore() || emails.isLoading()}
        hasMore={list.hasMore() || emails.hasMore()}
        onLoadMore={() => {
          if (list.hasMore()) void list.loadMore();
          void emails.loadMore();
        }}
        onSelect={(selected) => {
          const entity = entities().find((entity) => entity.id === selected.id);
          const item = entity && muteItemForEntity(entity);
          if (!item) return;
          props.onOpenChange(false);
          props.onSelectItem(item);
        }}
      />
    </Suspense>
  );
}

export function openSnoozeEntityPicker(options?: OpenDialogOptions) {
  openDialog(
    SnoozeEntityDialog,
    {
      // Keep the next picker under the original host, since selecting an item
      // disposes this entity picker's owner before the time picker opens.
      onSelectItem: (item) => openSnoozeNotifications([item], options),
    },
    options
  );
}
