import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Button } from '@ui';
export function ComposerOptionsToggle(props: {
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={props.expanded}
      onClick={props.onToggle}
      disabled={props.disabled}
    >
      {props.expanded ? t('calendar.fewerOptions') : t('calendar.moreOptions')}
      <CaretDownIcon
        class="size-3"
        classList={{ 'rotate-180': props.expanded }}
      />
    </Button>
  );
}
