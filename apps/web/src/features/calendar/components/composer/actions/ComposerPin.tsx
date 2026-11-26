import { t } from '@app/lib/i18n';
import SidePanelIcon from '@icon/system/regular/sidebar-simple.svg';
import { Button } from '@ui';

export function ComposerPin(props: {
  pinned: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const label = () =>
    props.pinned ? t('calendar.unpinComposer') : t('calendar.pinComposer');
  return (
    <Button
      variant="ghost"
      size="icon-md"
      aria-label={label()}
      aria-pressed={props.pinned}
      tooltip={label()}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      <SidePanelIcon class="size-4" />
    </Button>
  );
}
