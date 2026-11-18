import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

export function MobileRoutineTemplateHeader(props: {
  name: string;
  canActivate: boolean;
  onActivate(): void;
  onBack(): void;
}) {
  return (
    <MobileHeader
      trailing={
        <Show when={props.canActivate}>
          <MobileHeader.Island class="!px-1">
            <Button variant="ghost" size="sm" onClick={props.onActivate}>
              <PlayIcon class="size-4" />
              Activate for me
            </Button>
          </MobileHeader.Island>
        </Show>
      }
    >
      <MobileHeader.Island class="size-10 justify-center !px-0">
        <Button
          variant="ghost"
          size="icon-md"
          aria-label="Back to routines"
          onClick={props.onBack}
        >
          <ArrowLeftIcon class="size-5" />
        </Button>
      </MobileHeader.Island>
      <MobileHeader.Title label={props.name} />
    </MobileHeader>
  );
}
