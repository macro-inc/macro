import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerCancel(props: { onCancel: () => void; f3?: boolean }) {
  const model = useCalendarComposer();
  return (
    <Button
      variant="ghost"
      size={props.f3 ? 'field' : undefined}
      disabled={model.formIsDisabled()}
      onClick={props.onCancel}
    >
      {t('common.cancel')}
    </Button>
  );
}
