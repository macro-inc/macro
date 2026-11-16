import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Dropdown, Tooltip } from '@ui';
import { For } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

const VALUES = ['default', 'public', 'private', 'confidential'] as const;

export function ComposerVisibility() {
  const model = useCalendarComposer();
  const unavailable = () => model.editScope() === 'this_event';
  const labels = {
    get default() {
      return t('calendar.visibilityDefault');
    },
    get public() {
      return t('calendar.visibilityPublic');
    },
    get private() {
      return t('calendar.visibilityPrivate');
    },
    get confidential() {
      return t('calendar.visibilityConfidential');
    },
  };
  const label = () => {
    if (unavailable()) return t('calendar.visibilityUnavailable');
    const value = model.visibility();
    return value ? labels[value] : t('calendar.visibility');
  };
  return (
    <Dropdown placement="bottom-start">
      <Tooltip
        label={t('calendar.visibilityUnavailable')}
        disabled={!unavailable()}
      >
        <Dropdown.Trigger
          variant="value"
          finish="flat"
          size="sm"
          disabled={model.visibilityIsDisabled()}
          aria-label={t('calendar.visibility')}
        >
          {label()}
          <CaretDownIcon class="size-3" />
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content portalScope="local" class="min-w-48">
        <Dropdown.RadioGroup
          value={model.visibility()}
          onChange={(value) => {
            const visibility = VALUES.find((choice) => choice === value);
            if (visibility) model.setVisibility(visibility);
          }}
        >
          <For each={VALUES}>
            {(value) => (
              <Dropdown.RadioItem value={value} closeOnSelect>
                <span class="flex-1">{labels[value]}</span>
                <Dropdown.ItemIndicator />
              </Dropdown.RadioItem>
            )}
          </For>
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}
