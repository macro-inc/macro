import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import X from '@phosphor/x.svg';
import { Button } from '@ui';

export function SchedulingDrawerHeader(props: {
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div class="flex shrink-0 items-start justify-between gap-3 px-6 pb-4">
      <MobileDrawer.Title
        as="h2"
        title={props.title}
        class="line-clamp-2 min-w-0 break-words text-lg font-semibold text-ink"
      >
        {props.title}
      </MobileDrawer.Title>
      <Button
        variant="ghost"
        size="icon-sm"
        label={props.closeLabel}
        tooltipDisabled
        class="shrink-0 rounded-full bg-ink/6"
        onClick={props.onClose}
      >
        <X class="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
