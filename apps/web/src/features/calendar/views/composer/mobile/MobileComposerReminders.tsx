import { t } from '@app/lib/i18n';
import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { ComposerReminderPill } from '../../../components/composer/reminders/ComposerReminderPill';
import type { ComposerReminderOptions } from '../../../core/composer-reminders';
import { createComposerReminders } from '../../../primitives/create-composer-reminders';
import { formatReminderOffset } from '../../../utils/event-reminders';

export function MobileComposerReminders(props: ComposerReminderOptions) {
  const reminders = createComposerReminders(props);
  return (
    <SheetGroup>
      <For each={props.minutes}>
        {(minutes, index) => (
          <SheetRow
            icon={
              <Show when={index() === 0}>
                <BellIcon class="size-4" />
              </Show>
            }
          >
            <ComposerReminderPill
              minutes={minutes}
              offsets={reminders.offsets()}
              disabled={props.disabled}
              onChange={(value) => reminders.replace(index(), value)}
              onRemove={() => reminders.remove(index())}
            />
          </SheetRow>
        )}
      </For>
      <SheetRow
        icon={
          <Show when={props.minutes.length === 0}>
            <BellIcon class="size-4" />
          </Show>
        }
      >
        <Dropdown placement="bottom-start">
          <Dropdown.Trigger
            variant="ghost"
            size="sheet-row"
            fullWidth
            class="justify-start text-ink-subtle"
            disabled={props.disabled || !props.canAdd}
          >
            {t('calendar.addReminder')}
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local">
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
      </SheetRow>
      <Show when={props.preservedCount > 0}>
        <p class="px-3 pb-2 text-[13px] text-ink-muted">
          {t('calendar.otherNotificationsPreserved', {
            count: props.preservedCount,
          })}
        </p>
      </Show>
    </SheetGroup>
  );
}
