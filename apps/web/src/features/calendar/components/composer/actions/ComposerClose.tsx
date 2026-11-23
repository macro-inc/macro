import { t } from '@app/lib/i18n';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerClose(props: { onClose: () => void; f3?: boolean }) {
  const model = useCalendarComposer();
  return (
    <Button
      variant="ghost"
      size={props.f3 ? 'icon-md' : 'icon-sm'}
      aria-label={t('calendar.closeComposer')}
      disabled={model.formIsDisabled()}
      onClick={props.onClose}
    >
      <CloseIcon class="size-4" />
    </Button>
  );
}
