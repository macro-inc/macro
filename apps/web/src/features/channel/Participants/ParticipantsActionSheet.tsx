import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import type { ParentProps } from 'solid-js';

export function ParticipantsActionSheet(
  props: ParentProps<{
    title: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>
) {
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={props.title}>
          <MobileDrawer.Handle />
          <div class="flex items-center justify-between gap-2 px-4 pb-3">
            <MobileDrawer.Title class="text-base font-semibold">
              {props.title}
            </MobileDrawer.Title>
            <Button
              variant="ghost"
              size="icon-md"
              label="Close"
              onClick={() => props.onOpenChange(false)}
            >
              <XIcon />
            </Button>
          </div>
          <MobileDrawer.ScrollBody>
            <div class="px-4 pb-4">{props.children}</div>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
