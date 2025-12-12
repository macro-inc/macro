import { MACRO_EMAIL_SIGNATURE } from '@block-email/constants';
import { useHasPaidAccess } from '@core/auth';
import { Tooltip } from '@core/component/Tooltip';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { Show } from 'solid-js';

interface MacroSignatureButtonProps {
  signature?: string;
}

export const MacroSignatureButton = (props: MacroSignatureButtonProps) => {
  const paywall = usePaywallState();
  const hasPaidAccess = useHasPaidAccess();
  return (
    <Show when={!hasPaidAccess()}>
      <Tooltip tooltip="Subscribe to remove watermark" class="w-fit">
        <button
          type="button"
          class="hover:bg-hover pointer-events-all"
          tabindex={-1}
          // The text area uses non delegated events to capture on click and restore focus
          // to the editor. We want to capture the click here so we can open the paywall.
          // That's why we use `on:click` instead of `onClick`
          on:click={(e) => {
            e.stopImmediatePropagation();
            paywall.showPaywall(PaywallKey.REMOVE_SIGNATURE);
          }}
        >
          {props.signature ?? MACRO_EMAIL_SIGNATURE}
        </button>
      </Tooltip>
    </Show>
  );
};
