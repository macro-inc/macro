import { Match, Show, Switch, mergeProps, type Accessor } from 'solid-js';
import type { CallControlButtonSize } from './CallControlButton';
import { CallControlsDefaultAndPanelRow } from './CallControlsDefaultAndPanelRow';
import { CallControlsPanelSmallRow } from './CallControlsPanelSmallRow';

export type CallControlsVariant = 'default' | 'panel' | 'panel-small';

export type CallControlsProps = {
  /** Leave / hang up — parent supplies tab switch, `leaveCall()`, etc. */
  onLeave: () => void | Promise<void>;
  variant?: CallControlsVariant;
  when?: boolean | Accessor<boolean>;
};

function readWhen(when: boolean | Accessor<boolean> | undefined): boolean {
  if (when === undefined) return true;
  return typeof when === 'function' ? when() : when;
}

/**
 * Mic / camera / screen / leave wired to `useCallContext()`. Single place for
 * control markup so Call overlay and sidebar InCall panel stay in sync.
 */
export function CallControls(rawProps: CallControlsProps) {
  const props = mergeProps(
    { variant: 'default' as CallControlsVariant },
    rawProps
  );

  const variant = () => props.variant ?? 'default';

  const buttonSize = (): CallControlButtonSize =>
    variant() === 'default' ? 'md' : 'sm';

  return (
    <Show when={() => readWhen(props.when)}>
      <Switch
        fallback={
          <CallControlsDefaultAndPanelRow
            size={buttonSize}
            onLeave={props.onLeave}
          />
        }
      >
        <Match when={variant() === 'panel-small'}>
          <CallControlsPanelSmallRow onLeave={props.onLeave} />
        </Match>
      </Switch>
    </Show>
  );
}
