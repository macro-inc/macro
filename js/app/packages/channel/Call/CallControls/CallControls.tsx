import { type Accessor, Show } from 'solid-js';
import { useMaybeNativeCallState } from '../native-call-state';
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
 * control markup so the Call overlay and the sidebar InCall panel stay in
 * sync. The slim `panel-small` variant renders a single gear-menu instead of
 * the inline pill row.
 */
export function CallControls(props: CallControlsProps) {
  const nativeCall = useMaybeNativeCallState();

  return (
    <Show when={() => readWhen(props.when) && !nativeCall?.snapshot()}>
      <Show
        when={props.variant === 'panel-small'}
        fallback={<CallControlsDefaultAndPanelRow onLeave={props.onLeave} />}
      >
        <CallControlsPanelSmallRow />
      </Show>
    </Show>
  );
}
