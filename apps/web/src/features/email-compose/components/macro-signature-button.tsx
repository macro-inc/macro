import { MACRO_EMAIL_SIGNATURE } from '@app/features/email-compose/core/constants';
import { Tooltip } from '@ui';
import { Show } from 'solid-js';

interface MacroSignatureButtonProps {
  signature?: string;
  visible: boolean;
  onUpgrade?: () => void;
}

export const MacroSignatureButton = (props: MacroSignatureButtonProps) => {
  return (
    <Show when={props.visible}>
      <Tooltip label="Subscribe to remove watermark">
        <button
          type="button"
          class="hover:bg-hover pointer-events-auto"
          tabindex={-1}
          // The text area uses non delegated events to capture on click and restore focus
          // to the editor. We want to capture the click here so we can open the paywall.
          // That's why we use `on:click` instead of `onClick`
          on:click={(e) => {
            e.stopImmediatePropagation();
            props.onUpgrade?.();
          }}
        >
          {props.signature ?? MACRO_EMAIL_SIGNATURE}
        </button>
      </Tooltip>
    </Show>
  );
};
