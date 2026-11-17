import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Dropdown, Tooltip } from '@ui';
import { For } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerRecurrence(props: { fullWidth?: boolean } = {}) {
  const model = useCalendarComposer();
  const reason = model.recurrenceScopeReason;
  return (
    <Dropdown placement="bottom-start">
      <Tooltip
        label={reason() ?? ''}
        disabled={!reason()}
        class={props.fullWidth ? 'w-full' : undefined}
      >
        <Dropdown.Trigger
          variant={props.fullWidth ? 'row' : 'value'}
          finish="flat"
          size={props.fullWidth ? 'sheet-row' : 'sm'}
          fullWidth={props.fullWidth}
          class={props.fullWidth ? 'justify-between' : undefined}
          aria-label={t('calendar.composerRepeats')}
          aria-readonly={Boolean(reason()) || undefined}
          aria-describedby={model.recurrenceDescribedBy()}
          disabled={model.fieldIsDisabled('recurrence')}
        >
          <span
            class={
              props.fullWidth ? 'min-w-0 flex-1 truncate text-left' : undefined
            }
          >
            {model.controller.selectedRecurrenceOption().label}
          </span>
          <CaretDownIcon class="size-3.5" />
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content portalScope="local" class="min-w-48">
        <Dropdown.Group>
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
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
