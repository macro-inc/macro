import { t } from '@app/lib/i18n';
import PinIcon from '@icon/system/regular/push-pin.svg';
import UnpinIcon from '@icon/system/regular/push-pin-slash.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

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
      size="icon-sm"
      aria-label={label()}
      aria-pressed={props.pinned}
      tooltip={label()}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      <Show when={props.pinned} fallback={<PinIcon class="size-4" />}>
        <UnpinIcon class="size-4" />
      </Show>
    </Button>
  );
}
