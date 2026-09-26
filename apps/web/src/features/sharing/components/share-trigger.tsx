import IconShared from '@icon/share.svg';
import IconLink from '@phosphor/link.svg';
import { Button, Tooltip } from '@ui';

export function ShareTrigger(props: {
  tooltip: string;
  open(): void;
  copyLink(): void;
}) {
  return (
    <div class="flex items-center gap-1">
      <Tooltip label={props.tooltip}>
        <Button
          variant="plain"
          size="md"
          class="rounded-xl"
          onClick={props.open}
        >
          <IconShared />
          Share
        </Button>
      </Tooltip>

      <Button
        tooltip="Copy Share Link"
        variant="plain"
        size="icon-md"
        class="rounded-xl"
        onClick={(event) => {
          event.stopPropagation();
          props.copyLink();
        }}
      >
        <IconLink class="size-3.5!" />
      </Button>
    </div>
  );
}
