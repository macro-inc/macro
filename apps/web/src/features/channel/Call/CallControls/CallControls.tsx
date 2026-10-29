import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { type Accessor, Show } from 'solid-js';
import { useMaybeNativeCallState } from '../native-call-state';
import { setNativeCallKitVideoOverlayMode } from '../use-callkit';
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
    <Show when={readWhen(props.when)}>
      <Show when={isPlatform('android') && nativeCall?.snapshot()}>
        <div class="flex gap-2">
          <button
            type="button"
            onClick={() =>
              fireAndForget(
                setNativeCallKitVideoOverlayMode('expanded'),
                'channel-call'
              )
            }
          >
            Open call controls
          </button>
          <button
            type="button"
            onClick={() => fireAndForget(props.onLeave(), 'channel-call')}
          >
            End call
          </button>
        </div>
      </Show>
      <Show when={!nativeCall?.snapshot()}>
        <CallControlsDefaultAndPanelRow onLeave={props.onLeave} />
      </Show>
    </Show>
  );
}
