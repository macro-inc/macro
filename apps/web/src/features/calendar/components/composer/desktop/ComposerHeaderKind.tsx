import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Button } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

/** Existing event kind is read-only; creation choices live under the title. */
export function ComposerHeaderKind() {
  const model = useCalendarComposer();
  return (
    <Button
      variant="secondary"
      size="md"
      aria-label={t('calendar.eventKind')}
      disabled
    >
      {model.controller.eventKind() === 'out_of_office'
        ? t('calendar.eventKindOutOfOffice')
        : t('calendar.eventKindEvent')}
      <CaretDownIcon class="size-3" />
    </Button>
  );
}
