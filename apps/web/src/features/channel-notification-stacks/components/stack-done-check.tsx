import { t } from '@app/lib/i18n';
import BellIcon from '@icon/system/regular/bell.svg';
import { Button } from '@ui';

/**
 * The quiet bell beside a notification stack's newest message, which marks the
 * stack done.
 */
export function StackDoneCheck(props: { label: string; onDone: () => void }) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={t('channelNotificationStacks.markStackDone', {
        label: props.label,
      })}
      tooltip={{
        content: t('channelNotificationStacks.markDone'),
        placement: 'left',
      }}
      onClick={() => props.onDone()}
    >
      <BellIcon class="size-4" />
    </Button>
  );
}
