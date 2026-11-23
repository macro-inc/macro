import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Button } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

/** Existing event kind is read-only; creation choices live under the title. */
export function ComposerHeaderKind() {
  const model = useCalendarComposer();
  return (
    <Button
      variant="value"
      size="sm"
      class="h-8 rounded-full bg-button-secondary-bg pl-3 pr-2.5 text-xs font-medium"
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
