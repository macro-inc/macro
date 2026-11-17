import { t } from '@app/lib/i18n';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import AgentMark from '@icon/system/regular/sparkle.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { eventKindLabel } from '../out-of-office';

export function ComposerKind(props: { agentDraft?: boolean } = {}) {
  const model = useCalendarComposer();
  const changeKind = (value: string) => {
    if (model.formIsDisabled() || model.isEdit() || model.detailsLocked())
      return;
    if (value === 'default' || value === 'out_of_office') {
      model.controller.setEventKind(value);
    }
  };
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="secondary"
        finish="flat"
        size="sm"
        class="pl-2.5 pr-2 touch:min-h-7"
        aria-label={t('calendar.eventKind')}
        disabled={
          model.formIsDisabled() || model.isEdit() || model.detailsLocked()
        }
      >
        <Show when={props.agentDraft}>
          <AgentMark class="size-3.5" />
        </Show>
        {eventKindLabel(model.state().eventType)}
        <CaretDownIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-40">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={model.controller.eventKind()}
            onChange={changeKind}
          >
            <Dropdown.RadioItem value="default" closeOnSelect>
              <CalendarIcon class="size-4 shrink-0" />
              <span class="flex-1">{t('calendar.eventKindEvent')}</span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-3.5 text-accent" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
            <Dropdown.RadioItem value="out_of_office" closeOnSelect>
              <ProhibitIcon class="size-4 shrink-0" />
              <span class="flex-1">{t('calendar.eventKindOutOfOffice')}</span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-3.5 text-accent" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
