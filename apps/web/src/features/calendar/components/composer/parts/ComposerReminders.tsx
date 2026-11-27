import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import type { ComposerReminderOptions } from '../../../primitives/create-composer-reminders';
import { createComposerReminders } from '../../../primitives/create-composer-reminders';
import { formatReminderOffset } from '../../../utils/event-reminders';
import { ComposerReminderPill } from './ComposerReminderPill';

export function ComposerReminders(props: ComposerReminderOptions) {
  const reminders = createComposerReminders(props);
  return (
    <div class="flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-1">
        <For each={props.minutes}>
          {(minutes, index) => (
            <ComposerReminderPill
              minutes={minutes}
              offsets={reminders.offsets()}
              disabled={props.disabled}
              onChange={(value) => reminders.replace(index(), value)}
              onRemove={() => reminders.remove(index())}
            />
          )}
        </For>
        <Dropdown placement="bottom-start">
          <Dropdown.Trigger
            variant="ghost"
            size="sm"
            aria-label={t('calendar.addNotification')}
            disabled={props.disabled || !props.canAdd}
            classList={{ 'text-ink-subtle': props.minutes.length === 0 }}
          >
            <PlusIcon class="size-3.5" />
            {t('calendar.add')}
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local" class="min-w-48">
            <Dropdown.Group>
              <For each={reminders.offsets()}>
                {(offset) => (
                  <Dropdown.Item
                    disabled={props.minutes.includes(offset)}
                    onSelect={() => reminders.add(offset)}
                  >
                    {formatReminderOffset(offset)}
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </div>
      <Show when={props.preservedCount > 0}>
        <p class="text-xs text-ink-muted">
          {t('calendar.otherNotificationsPreserved', {
            count: props.preservedCount,
          })}
        </p>
      </Show>
    </div>
  );
}
