import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';

export function MobileRoutineEditorHeader(props: {
  name: string;
  identityIcon?: JSX.Element;
  headerActions?: JSX.Element;
  actions?: JSX.Element;
  onBack(): void;
}) {
  return (
    <MobileHeader
      trailing={
        <>
          <Show when={props.headerActions}>
            {(actions) => (
              <MobileHeader.Island class="!px-1">
                {actions()}
              </MobileHeader.Island>
            )}
          </Show>
          <Show when={props.actions}>
            {(actions) => (
              <MobileHeader.Island class="size-10 justify-center !px-0">
                {actions()}
              </MobileHeader.Island>
            )}
          </Show>
        </>
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
      <MobileHeader.Title
        label={props.name}
        icon={props.identityIcon ?? <ClockIcon class="size-4" />}
      />
    </MobileHeader>
  );
}
