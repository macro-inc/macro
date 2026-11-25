import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import ClockIcon from '@icon/system/regular/clock.svg';
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
      <MobileHeader.Back onBack={props.onBack} />
      <MobileHeader.Title
        label={props.name}
        icon={props.identityIcon ?? <ClockIcon class="size-4" />}
      />
    </MobileHeader>
  );
}
