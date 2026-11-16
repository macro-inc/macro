import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerCancel(props: { onCancel: () => void }) {
  const model = useCalendarComposer();
  return (
    <Button
      variant="ghost"
      disabled={model.formIsDisabled()}
      onClick={props.onCancel}
    >
      {t('common.cancel')}
    </Button>
  );
}
