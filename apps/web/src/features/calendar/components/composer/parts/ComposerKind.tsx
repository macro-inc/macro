import { t } from '@app/lib/i18n';
import { Tabs } from '@ui';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

/** Creation choices stay beneath the title, never in the draggable header. */
export function ComposerKind(props: { f3?: boolean } = {}) {
  const model = useCalendarComposer();
  return (
    <Show when={!model.isEdit()}>
      <Tabs
        aria-label={t('calendar.eventKind')}
        options={[
          { value: 'default', label: t('calendar.eventKindEvent') },
          { value: 'out_of_office', label: t('calendar.eventKindOutOfOffice') },
        ]}
        value={model.controller.eventKind()}
        onChange={model.controller.setEventKind}
        disabled={model.formIsDisabled() || model.detailsLocked()}
        variant={props.f3 ? 'choices-filled' : 'choices'}
        wrap
        touch="pills"
        size={props.f3 ? 'md' : 'sm'}
      />
    </Show>
  );
}
