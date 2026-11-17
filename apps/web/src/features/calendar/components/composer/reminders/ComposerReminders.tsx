import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import type { ComposerReminderOptions } from '../../../core/composer-reminders';
import { createComposerReminders } from '../../../primitives/create-composer-reminders';
import { formatReminderOffset } from '../../../utils/event-reminders';

export function ComposerReminders(props: ComposerReminderOptions) {
  const reminders = createComposerReminders(props);
  return (
    <div class="flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-1">
        <For each={props.minutes}>
          {(minutes, index) => (
            <div class="group inline-flex items-center gap-0.5">
              <Dropdown placement="bottom-start">
                <Dropdown.Trigger
                  variant="value"
                  finish="flat"
                  size="sm"
                  disabled={props.disabled}
                >
                  {formatReminderOffset(minutes)}
                </Dropdown.Trigger>
                <Dropdown.Content portalScope="local" class="min-w-48">
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
                size="icon-sm"
                aria-label={t('calendar.removeNotification', {
                  offset: formatReminderOffset(minutes),
                })}
                disabled={props.disabled}
                class="not-touch:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => reminders.remove(index())}
              >
                <CloseIcon class="size-3" />
              </Button>
            </div>
          )}
        </For>
        <Dropdown placement="bottom-start">
          <Dropdown.Trigger
            variant="ghost"
            size="sm"
            aria-label={t('calendar.addNotification')}
            disabled={props.disabled || !props.canAdd}
          >
            <PlusIcon class="size-3.5" />
            {t('calendar.add')}
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local" class="min-w-48">
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
