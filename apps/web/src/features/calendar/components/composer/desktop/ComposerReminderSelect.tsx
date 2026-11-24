import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Button, Dropdown, Input } from '@ui';
import { For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { createComposerReminders } from '../../../primitives/create-composer-reminders';
import { formatReminderOffset } from '../../../utils/event-reminders';

/** Full-width reminder picker for the desktop composer. */
export function ComposerReminderSelect() {
  const model = useCalendarComposer();
  const controller = model.controller;
  const reminders = createComposerReminders({
    get minutes() {
      return controller.reminderMinutes();
    },
    get canAdd() {
      return controller.canAddReminder();
    },
    get preservedCount() {
      return controller.preservedReminderCount();
    },
    get disabled() {
      return model.fieldIsDisabled('reminders');
    },
    onChange: controller.setReminderMinutes,
  });
  const [custom, setCustom] = createStore({ open: false, minutes: '' });
  const customOffset = () => {
    if (custom.minutes.trim() === '') return undefined;
    const offset = Number(custom.minutes);
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : undefined;
  };
  const addCustom = () => {
    const offset = customOffset();
    if (offset === undefined) return;
    reminders.add(offset);
    setCustom({ open: false, minutes: '' });
  };
  const minutes = controller.reminderMinutes;
  const disabled = () => model.fieldIsDisabled('reminders');
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <Dropdown
        placement="bottom-start"
        onOpenChange={(open) => {
          if (!open) setCustom({ open: false, minutes: '' });
        }}
      >
        <Dropdown.Trigger
          variant="value"
          finish="flat"
          size="select"
          fullWidth
          aria-label={t('calendar.reminder')}
          disabled={disabled()}
        >
          <span class="min-w-0 flex-1 truncate text-left">
            {minutes().length
              ? minutes().map(formatReminderOffset).join(', ')
              : t('calendar.addReminder')}
          </span>
          <CaretDownIcon class="size-3.5" />
        </Dropdown.Trigger>
        <Dropdown.Content
          portalScope="local"
          class="w-[var(--kb-popper-anchor-width)] min-w-48"
        >
          <Dropdown.Group>
            <For each={reminders.offsets()}>
              {(offset) => {
                const label = () => formatReminderOffset(offset);
                const checked = () => minutes().includes(offset);
                return (
                  <Dropdown.MultiSelectItem
                    label={label()}
                    checked={checked()}
                    disabled={
                      disabled() || (!checked() && !controller.canAddReminder())
                    }
                    onChange={(selected) => {
                      if (selected) reminders.add(offset);
                      else {
                        const index = minutes().indexOf(offset);
                        if (index !== -1) reminders.remove(index);
                      }
                    }}
                    onOnly={() => {
                      if (!disabled()) controller.setReminderMinutes([offset]);
                    }}
                  >
                    <span class="min-w-0 flex-1 truncate">{label()}</span>
                  </Dropdown.MultiSelectItem>
                );
              }}
            </For>
            <Show when={!custom.open}>
              <Dropdown.Item
                disabled={disabled() || !controller.canAddReminder()}
                closeOnSelect={false}
                onSelect={() => setCustom('open', true)}
              >
                {t('calendar.customReminder')}
              </Dropdown.Item>
            </Show>
            <Show when={custom.open}>
              <div class="flex items-center gap-2 p-1">
                <Input
                  ref={(element) =>
                    queueMicrotask(() => {
                      if (element.isConnected) element.focus();
                    })
                  }
                  type="number"
                  min="0"
                  step="1"
                  variant="value"
                  size="md"
                  class="flex-1 rounded-lg text-sm"
                  aria-label={t('calendar.customReminderMinutes')}
                  aria-invalid={
                    custom.minutes !== '' && customOffset() === undefined
                  }
                  disabled={disabled() || !controller.canAddReminder()}
                  value={custom.minutes}
                  onInput={(event) =>
                    setCustom('minutes', event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    // The menu must not type-ahead or submit the surrounding form.
                    if (event.key !== 'Escape') event.stopPropagation();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addCustom();
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  size="md"
                  disabled={
                    disabled() ||
                    !controller.canAddReminder() ||
                    customOffset() === undefined
                  }
                  onClick={addCustom}
                >
                  {t('calendar.add')}
                </Button>
              </div>
            </Show>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <Show when={controller.preservedReminderCount() > 0}>
        <p class="text-xs text-ink-muted">
          {t('calendar.otherNotificationsPreserved', {
            count: controller.preservedReminderCount(),
          })}
        </p>
      </Show>
    </div>
  );
}
