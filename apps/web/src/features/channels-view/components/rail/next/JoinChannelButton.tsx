import { t } from '@app/lib/i18n';
import { useJoinChannelMutation } from '@queries/channel/join-links';
import { Button } from '@ui';

export function JoinChannelButton(props: {
  channelId: string;
  hoverOnly?: boolean;
}) {
  const join = useJoinChannelMutation();
  return (
    <span
      class={
        props.hoverOnly
          ? 'opacity-0 group-hover/channel-option:opacity-100 group-focus-within/channel-option:opacity-100 touch:opacity-100'
          : undefined
      }
    >
      <Button
        variant="secondary"
        size="xs"
        disabled={join.isPending}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          join.mutate({ channelId: props.channelId });
        }}
      >
        {t('channelSections.join')}
      </Button>
    </span>
  );
}
