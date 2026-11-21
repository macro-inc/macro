import { t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button } from '@ui';

/** The quiet check beside a notification stack's newest message. */
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
      <CheckIcon class="size-4" />
    </Button>
  );
}
