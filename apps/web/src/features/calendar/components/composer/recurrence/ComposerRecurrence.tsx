import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Dropdown, Tooltip } from '@ui';
import { For } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerRecurrence() {
  const model = useCalendarComposer();
  const reason = model.recurrenceScopeReason;
  return (
    <Dropdown placement="bottom-start">
      <Tooltip label={reason() ?? ''} disabled={!reason()}>
        <Dropdown.Trigger
          variant="value"
          finish="flat"
          size="sm"
          aria-label={t('calendar.composerRepeats')}
          aria-readonly={Boolean(reason()) || undefined}
          aria-describedby={model.recurrenceDescribedBy()}
          disabled={model.fieldIsDisabled('recurrence')}
        >
          {model.controller.selectedRecurrenceOption().label}
          <CaretDownIcon class="size-3.5" />
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content portalScope="local" class="min-w-48">
        <Dropdown.RadioGroup
          value={model.controller.recurrenceChoice()}
          onChange={(value) => {
            if (!reason()) model.controller.changeRecurrenceChoice(value);
          }}
        >
          <For each={model.controller.recurrenceOptions()}>
            {(option) => (
              <Dropdown.RadioItem
                value={option.value}
                disabled={Boolean(reason())}
                closeOnSelect
              >
                <span class="flex-1">{option.label}</span>
                <Dropdown.ItemIndicator />
              </Dropdown.RadioItem>
            )}
          </For>
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}
