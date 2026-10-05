import { createSignal } from 'solid-js';
import { AutoReloadDialog } from '../components/auto-reload-dialog';
import type { UsageContext } from '../context/usage-context';
import { createAutoReloadForm } from '../primitives/auto-reload-form';

export function AutoReloadView(props: {
  context: UsageContext;
  onClose: () => void;
  onRestoreFocus?: () => void;
}) {
  const form = createAutoReloadForm(props.context.autoReload.settings());
  const [error, setError] = createSignal<string>();
  const notice = () => {
    if (props.context.autoReload.preview())
      return 'Developer preview. These settings only change this preview and will not charge your card.';
    if (!props.context.autoReload.available())
      return 'Automatic reload is not available yet. You can buy usage credits manually.';
  };
  const save = async (enabled: boolean) => {
    const settings = enabled
      ? form.settings()
      : props.context.autoReload.settings();
    if (
      !settings ||
      !props.context.autoReload.available() ||
      props.context.autoReload.pending() ||
      (enabled && form.error())
    )
      return;
    setError(undefined);
    try {
      await props.context.autoReload.save({ ...settings, enabled });
      props.onClose();
    } catch {
      setError("Couldn't save Auto-Reload settings. Please try again.");
    }
  };
  const paymentMethods = async () => {
    if (
      props.context.summary()?.billingAccess !== 'payer' ||
      props.context.autoReload.preview() ||
      props.context.developer?.exhausted() ||
      props.context.paymentMethods.pending()
    )
      return;
    setError(undefined);
    try {
      const url = await props.context.paymentMethods.open();
      props.context.navigateToPayment(url);
    } catch {
      setError("Couldn't open payment methods. Please try again.");
    }
  };
  return (
    <AutoReloadDialog
      enabled={props.context.autoReload.settings().enabled}
      minimum={form.minimum()}
      target={form.target()}
      maximum={form.maximum()}
      onMinimum={form.setMinimum}
      onTarget={form.setTarget}
      onMaximum={form.setMaximum}
      onClose={props.onClose}
      onRestoreFocus={props.onRestoreFocus}
      onSave={() => void save(true)}
      onTurnOff={() => void save(false)}
      onPaymentMethods={() => void paymentMethods()}
      canManagePaymentMethods={
        props.context.summary()?.billingAccess === 'payer' &&
        !props.context.autoReload.preview() &&
        !props.context.developer?.exhausted()
      }
      pending={props.context.autoReload.pending()}
      paymentMethodsPending={props.context.paymentMethods.pending()}
      disabled={!props.context.autoReload.available()}
      invalid={!!form.error()}
      notice={notice()}
      error={form.error() ?? error()}
    />
  );
}
