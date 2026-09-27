import { toast } from '@core/component/Toast/Toast';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { useMuteItemMutation } from '@queries/notification/unsubscribes';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { type ManagedDialogProps, openDialog } from '@ui';
import { createSignal } from 'solid-js';
import { SnoozePicker } from './components/SnoozePicker';
import {
  formatSnoozeDeadline,
  type SnoozeOption,
  snoozePresets,
} from './core/snooze';
import { createSnoozeController } from './primitives/create-snooze-controller';

function SnoozeNotificationsDialog(
  props: ManagedDialogProps & { items: UserUnsubscribe[] }
) {
  const mutation = useMuteItemMutation();
  const [query, setQuery] = createSignal('');
  const dates = useDateSearch({ query, defaultTime: { hours: 9, minutes: 0 } });
  const options = (): SnoozeOption[] => {
    const presets = snoozePresets(new Date());
    const search = query().trim().toLowerCase();
    if (!search) return presets;
    const matches = presets.filter(
      (preset) =>
        preset.label.toLowerCase().includes(search) ||
        preset.id.includes(search)
    );
    const parsed = dates()
      .filter((date) => date.date.getTime() > Date.now())
      .map((date) => ({
        id: date.id,
        label: date.displayText,
        until: date.date,
      }));
    const seen = new Set<number>();
    return [...matches, ...parsed].filter((option) => {
      const time = option.until.getTime();
      if (seen.has(time)) return false;
      seen.add(time);
      return true;
    });
  };
  const controller = createSnoozeController({
    items: props.items,
    saveItem: (item, until) =>
      mutation.mutateAsync({ ...item, snoozed_until: until }),
    onSaved: (until, count) => {
      props.onOpenChange(false);
      toast.success(
        `Snoozed ${count} ${count === 1 ? 'item' : 'items'} until ${formatSnoozeDeadline(until)}`
      );
    },
  });
  return (
    <SnoozePicker
      {...props}
      count={controller.remainingCount()}
      query={query()}
      onQueryChange={setQuery}
      options={options()}
      pending={controller.pending()}
      error={controller.error()}
      onSelect={(until) => void controller.submit(until)}
    />
  );
}

/** Shared entry point for entity commands, context menus, and notification settings. */
export function openSnoozeNotifications(items: UserUnsubscribe[]) {
  const unique = [
    ...new Map(
      items.map((item) => [`${item.item_type}:${item.item_id}`, item])
    ).values(),
  ];
  // The app dialog host owns this lifetime: context menus unmount on selection.
  if (unique.length) openDialog(SnoozeNotificationsDialog, { items: unique });
}
