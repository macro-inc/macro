import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { ButtonGroup, Dropdown } from '@ui';
import { For } from 'solid-js';
import { formatReminderOffset } from '../../../utils/event-reminders';

export function ComposerReminderPill(props: {
  minutes: number;
  offsets: number[];
  disabled?: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <Dropdown placement="bottom-start">
      <ButtonGroup variant="value" size="sm" finish="flat">
        <Dropdown.Trigger
          as={ButtonGroup.Button}
          variant="value"
          disabled={props.disabled}
        >
          {formatReminderOffset(props.minutes)}
          <CaretDownIcon class="size-3" />
        </Dropdown.Trigger>
        <ButtonGroup.Button
          size="icon-xs"
          aria-label={t('calendar.removeNotification', {
            offset: formatReminderOffset(props.minutes),
          })}
          disabled={props.disabled}
          onClick={props.onRemove}
        >
          <CloseIcon class="size-3" />
        </ButtonGroup.Button>
      </ButtonGroup>
      <Dropdown.Content portalScope="local" class="min-w-48">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={String(props.minutes)}
            onChange={props.onChange}
          >
            <For each={props.offsets}>
              {(offset) => (
                <Dropdown.RadioItem value={String(offset)} closeOnSelect>
                  <span class="flex-1">{formatReminderOffset(offset)}</span>
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
