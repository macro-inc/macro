import { t } from '@app/lib/i18n';
import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
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
            <div class="flex min-w-0 items-center">
              <Dropdown placement="bottom-start">
                <Dropdown.Trigger
                  variant="ghost"
                  size="sheet"
                  class="flex-1 justify-start"
                  disabled={props.disabled}
                >
                  {formatReminderOffset(minutes)}
                </Dropdown.Trigger>
                <Dropdown.Content portalScope="local">
                  <Dropdown.RadioGroup
                    value={String(minutes)}
                    onChange={(value) => reminders.replace(index(), value)}
                  >
                    <For each={reminders.offsets()}>
                      {(offset) => (
                        <Dropdown.RadioItem
                          value={String(offset)}
                          closeOnSelect
                        >
                          <span class="flex-1">
                            {formatReminderOffset(offset)}
                          </span>
                          <Dropdown.ItemIndicator />
                        </Dropdown.RadioItem>
                      )}
                    </For>
                  </Dropdown.RadioGroup>
                </Dropdown.Content>
              </Dropdown>
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={t('calendar.removeNotification', {
                  offset: formatReminderOffset(minutes),
                })}
                disabled={props.disabled}
                onClick={() => reminders.remove(index())}
              >
                <CloseIcon class="size-4" />
              </Button>
            </div>
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
            size="sheet"
            fullWidth
            class="justify-start"
            disabled={props.disabled || !props.canAdd}
          >
            {t('calendar.addReminder')}
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local">
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
