import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

const DECLINE_MODES = [
  {
    value: 'decline_only_new_conflicting_invitations',
    label: 'calendar.declineNew',
  },
  {
    value: 'decline_all_conflicting_invitations',
    label: 'calendar.declineAll',
  },
  { value: 'decline_none', label: 'calendar.declineNone' },
] as const;

export function ComposerDecline() {
  const model = useCalendarComposer();
  const selected = () =>
    DECLINE_MODES.find(
      (mode) => mode.value === model.state().outOfOffice?.autoDeclineMode
    );
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="value"
        finish="flat"
        size="sm"
        aria-label={t('calendar.declineMode')}
        disabled={model.fieldIsDisabled('outOfOffice')}
      >
        <Show when={selected()} fallback={t('calendar.declineMode')}>
          {(mode) => <span>{t(mode().label)}</span>}
        </Show>
        <CaretDownIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-56">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={model.state().outOfOffice?.autoDeclineMode}
            onChange={(value) => {
              if (model.fieldIsDisabled('outOfOffice')) return;
              const mode = DECLINE_MODES.find((mode) => mode.value === value);
              if (!mode) return;
              model.controller.setOutOfOffice({
                autoDeclineMode: mode.value,
                declineMessage: model.state().outOfOffice?.declineMessage ?? '',
              });
            }}
          >
            <For each={DECLINE_MODES}>
              {(mode) => (
                <Dropdown.RadioItem value={mode.value} closeOnSelect>
                  <span class="flex-1">{t(mode.label)}</span>
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
