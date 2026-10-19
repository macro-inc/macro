import type {
  RecipientOption,
  ShareForm,
} from '@app/features/sharing/share-delivery/share-delivery';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { isMobile } from '@core/mobile/isMobile';
import type { useCombinedRecipients } from '@core/signal/useCombinedRecipient';

/**
 * The Share menu's To field: borderless in the dialog's To row, and a
 * bordered box whose chips wrap in the phone drawer.
 */
export function ShareRecipientField(props: {
  form: ShareForm<RecipientOption>;
  options: ReturnType<typeof useCombinedRecipients>['all'];
}) {
  return (
    <RecipientSelector<'user' | 'contact' | 'channel'>
      placeholder="To: Email or group"
      setSelectedOptions={props.form.setRecipients}
      selectedOptions={props.form.recipients()}
      triedToSubmit={props.form.triedToSubmit}
      options={props.options}
      triggerMode="input"
      focusOnMount
      horizontalScroll={!isMobile()}
      hideBorder={!isMobile()}
      class={isMobile() ? 'border border-edge-muted p-1' : undefined}
      disabled={props.form.locked()}
    />
  );
}
