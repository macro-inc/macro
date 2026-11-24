import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Dropdown, Tooltip } from '@ui';
import { For } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

const VALUES = ['default', 'public', 'private'] as const;

export function ComposerVisibility(props: { size?: 'sm' | 'md' } = {}) {
  const model = useCalendarComposer();
  const unavailable = () => model.editScope() === 'this_event';
  const reason = () =>
    model.options.visibilityReadOnlyReason ??
    (unavailable() ? t('calendar.visibilityUnavailable') : undefined);
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
  };
  const displayedVisibility = () => {
    const visibility = model.visibility();
    return visibility === 'confidential' ? 'private' : visibility;
  };
  const label = () => {
    if (model.options.visibilityReadOnlyReason) return t('calendar.visibility');
    if (unavailable()) return t('calendar.visibilityUnavailable');
    const value = displayedVisibility();
    return value ? labels[value] : t('calendar.visibility');
  };
  return (
    <Dropdown placement="bottom-start">
      <Tooltip label={reason() ?? ''} disabled={!reason()}>
        <Dropdown.Trigger
          variant="value"
          finish="flat"
          size={props.size ?? 'sm'}
          disabled={model.visibilityIsDisabled()}
          aria-label={t('calendar.visibility')}
        >
          <span>{label()}</span>
          <CaretDownIcon class="size-3" />
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content portalScope="local" class="min-w-48">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={displayedVisibility()}
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
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
