import { fireAndForget } from '@core/util/fireAndForget';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import type { AgentFaceLook } from '../core/agent-face';
import { AgentFacePicker } from './agent-face-picker';

/**
 * How an agent looks: the face and color picker, then uploading a picture
 * instead, and an optional way back from one choice to the other.
 */
export function AgentLookFields(props: {
  look: AgentFaceLook;
  /** See `AgentFacePicker`. */
  chosen?: boolean;
  onChange: (look: AgentFaceLook) => void;
  /** Off while an uploaded picture stands in for the face. */
  showPicker: boolean;
  busy: boolean;
  uploading: boolean;
  uploadLabel: string;
  onUpload: (file: File | undefined) => Promise<void>;
  /** A second action beside Upload, such as going back to a face. */
  secondary?: { label: string; onClick: () => void };
}) {
  let input: HTMLInputElement | undefined;
  // Clear the input afterwards so choosing the same file again still uploads.
  const upload = async (element: HTMLInputElement) => {
    await props.onUpload(element.files?.[0]);
    element.value = '';
  };
  return (
    <>
      <Show when={props.showPicker}>
        <AgentFacePicker
          look={props.look}
          chosen={props.chosen}
          onChange={props.onChange}
        />
      </Show>
      <div class="mt-5 flex flex-wrap items-center justify-center gap-1">
        <input
          ref={input}
          type="file"
          accept="image/*"
          class="hidden"
          disabled={props.busy}
          onChange={(event) =>
            fireAndForget(upload(event.currentTarget), 'agent-settings')
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="md"
          disabled={props.busy}
          onClick={() => input?.click()}
        >
          <UploadIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
          {props.uploading ? 'Uploading…' : props.uploadLabel}
        </Button>
        <Show when={props.secondary}>
          {(secondary) => (
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={props.busy}
              onClick={secondary().onClick}
            >
              {secondary().label}
            </Button>
          )}
        </Show>
      </div>
    </>
  );
}
