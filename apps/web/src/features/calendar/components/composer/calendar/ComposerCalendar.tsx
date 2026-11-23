import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { CalendarSwatch } from '../../calendar-swatch/CalendarSwatch';

export function ComposerCalendar(
  props: { fullWidth?: boolean; size?: 'sm' | 'md' } = {}
) {
  const model = useCalendarComposer();
  const selected = model.controller.selectedCalendarOption;
  const readOnly = () => model.isEdit() || model.fieldIsDisabled('calendar');
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant={props.fullWidth ? 'row' : 'value'}
        finish="flat"
        size={props.fullWidth ? 'sheet-row' : (props.size ?? 'sm')}
        fullWidth={props.fullWidth}
        class={props.fullWidth ? 'justify-between' : undefined}
        aria-label={t('calendar.composerCalendar')}
        disabled={readOnly()}
      >
        <Show when={selected()} fallback={t('calendar.chooseCalendar')}>
          {(calendar) => (
            <>
              <CalendarSwatch color={calendar().color} />
              <span
                class={
                  props.fullWidth
                    ? 'min-w-0 flex-1 truncate text-left'
                    : undefined
                }
              >
                {calendar().label}
              </span>
            </>
          )}
        </Show>
        <CaretDownIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-48">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={model.controller.effectiveCalendarId()}
            onChange={(calendarId) => {
              if (!readOnly())
                model.controller.setField('calendarId', calendarId);
            }}
          >
            <For each={model.controller.calendarOptions()}>
              {(calendar) => (
                <Dropdown.RadioItem value={calendar.id} closeOnSelect>
                  <CalendarSwatch color={calendar.color} />
                  <span class="min-w-0 flex-1 truncate">{calendar.label}</span>
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
