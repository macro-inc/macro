import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { CalendarUpdateScope } from '@service-email/client';
import { Button, Dropdown } from '@ui';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerScopeOptions(props: {
  onSelect: (scope: CalendarUpdateScope) => void;
}) {
  return (
    <Dropdown.Group>
      <Dropdown.Item onSelect={() => props.onSelect('this_event')}>
        {t('calendar.applyToThisEvent')}
      </Dropdown.Item>
      <Dropdown.Item onSelect={() => props.onSelect('all')}>
        {t('calendar.applyToAllEvents')}
      </Dropdown.Item>
    </Dropdown.Group>
  );
}
export function ComposerSubmit(
  props: { fullWidth?: boolean; f3?: boolean } = {}
) {
  const model = useCalendarComposer();
  const label = () =>
    model.isEdit() ? t('calendar.saveEvent') : t('calendar.createEvent');
  const size = () =>
    props.fullWidth ? 'sheet' : props.f3 ? 'field' : undefined;
  const disabled = () => model.formIsDisabled() || !model.canSave();
  const content = () => (
    <Show when={model.options.pending} fallback={label()}>
      <SpinnerIcon class="size-4 animate-spin" />
    </Show>
  );
  return (
    <Show
      when={model.options.showRecurringEditNotice}
      fallback={
        <Button
          type="submit"
          form={model.ids.form}
          variant="primary"
          size={size()}
          fullWidth={props.fullWidth}
          aria-label={label()}
          disabled={disabled()}
        >
          {content()}
        </Button>
      }
    >
      <Dropdown
        open={model.saveMenuOpen() && !disabled()}
        onOpenChange={model.changeSaveMenuOpen}
        placement="top-end"
      >
        <Dropdown.Trigger
          type="submit"
          form={model.ids.form}
          variant="primary"
          size={size()}
          fullWidth={props.fullWidth}
          aria-label={label()}
          disabled={disabled()}
        >
          {content()}
        </Dropdown.Trigger>
        <Dropdown.Content portalScope="local">
          <ComposerScopeOptions onSelect={model.submitWithScope} />
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
