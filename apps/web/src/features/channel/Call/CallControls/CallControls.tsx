import { type Accessor, Show } from 'solid-js';
import { useMaybeNativeCallState } from '../native-call-state';
import { CallControlsDefaultAndPanelRow } from './CallControlsDefaultAndPanelRow';

export type CallControlsProps = {
  /** Leave / hang up — parent supplies tab switch, `leaveCall()`, etc. */
  onLeave: () => void | Promise<void>;
  when?: boolean | Accessor<boolean>;
};

function readWhen(when: boolean | Accessor<boolean> | undefined): boolean {
  if (when === undefined) return true;
  return typeof when === 'function' ? when() : when;
}

/** Mic / camera / screen / leave wired to `useCallContext()`. */
export function CallControls(props: CallControlsProps) {
  const nativeCall = useMaybeNativeCallState();

  return (
    <Show when={() => readWhen(props.when) && !nativeCall?.snapshot()}>
      <CallControlsDefaultAndPanelRow onLeave={props.onLeave} />
    </Show>
  );
}
