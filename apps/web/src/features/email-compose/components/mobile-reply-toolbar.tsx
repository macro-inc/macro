import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import { Button } from '@ui';
import type { JSX } from 'solid-js';
import { MobileComposeActions } from './mobile-compose-actions';

/** Same header controls as new email, with Back returning to the thread. */
export function MobileReplyToolbar(props: {
  onBack: () => void;
  attachRef: (element: HTMLButtonElement) => void;
  onSend: () => void;
  sendLabel: string;
  sendDisabled: boolean;
  sending: boolean;
  editingDisabled: boolean;
  scheduleSummary?: JSX.Element;
  scheduleControl?: JSX.Element;
}) {
  return (
    <div class="sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 bg-surface px-(--mobile-chrome-gutter) pb-3 pt-[calc(var(--safe-top,0px)+12px)]">
      <HeaderIsland class="size-(--mobile-chrome-button-size) justify-center p-0">
        <Button
          aria-label="Go Back"
          tooltip="Go Back"
          variant="ghost"
          size="icon-sm"
          onClick={props.onBack}
        >
          <CaretLeft class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
      </HeaderIsland>
      <div class="ml-auto">
        <MobileComposeActions {...props} />
      </div>
      {props.scheduleSummary}
    </div>
  );
}
