import { Match, Show, Switch, mergeProps, type Accessor } from 'solid-js';
import type { CallControlVariant } from './CallControlButton';
import { CallControlsDefaultAndPanelRow } from './CallControlsDefaultAndPanelRow';
import { CallControlsPanelSmallRow } from './CallControlsPanelSmallRow';

export type CallControlsProps = {
  /** Leave / hang up — parent supplies tab switch, `leaveCall()`, etc. */
  onLeave: () => void | Promise<void>;
  variant?: CallControlVariant;
  when?: boolean | Accessor<boolean>;
};

function readWhen(
  when: boolean | Accessor<boolean> | undefined
): boolean {
  if (when === undefined) return true;
  return typeof when === 'function' ? when() : when;
}

/**
 * Mic / camera / screen / leave wired to `useCallContext()`. Single place for
 * control markup so Call overlay and sidebar InCall panel stay in sync.
 */
export function CallControls(rawProps: CallControlsProps) {
  const props = mergeProps(
    { variant: 'default' as CallControlVariant },
    rawProps
  );

  const variant = () => props.variant ?? 'default';

  return (
    <Show when={() => readWhen(props.when)}>
      <Switch
        fallback={
          <CallControlsDefaultAndPanelRow
            variant={variant}
            onLeave={props.onLeave}
          />
        }
      >
        <Match when={variant() === 'panel-small'}>
          <CallControlsPanelSmallRow
            onLeave={props.onLeave}
          />
        </Match>
      </Switch>
    </Show>
  );
}
