import { thrownResultErrorHasCode } from '@core/util/result';
import { createSignal } from 'solid-js';
import { CreditPurchaseDialog } from '../components/credit-purchase-dialog';
import type { UsageContext } from '../context/usage-context';
import { parseDollarInput } from '../core/usage';

export function CreditPurchaseView(props: {
  context: UsageContext;
  onClose: () => void;
  onRestoreFocus?: () => void;
}) {
  const [selection, setSelection] = createSignal<number | 'other'>(2_500);
  const [customAmount, setCustomAmount] = createSignal('');
  const [error, setError] = createSignal<string>();
  const [subscriptionRequired, setSubscriptionRequired] = createSignal(false);
  const amountCents = () => {
    const selected = selection();
    return typeof selected === 'number'
      ? selected
      : parseDollarInput(customAmount());
  };
  const previewing = () =>
    props.context.developer?.exhausted() || props.context.autoReload.preview();
  const notice = () => {
    if (previewing())
      return 'Credit purchases are disabled during the developer preview.';
    if (props.context.summary()?.billingAccess === 'free')
      return 'Subscribe to a paid plan to buy additional usage credits.';
    if (props.context.summary()?.billingAccess !== 'payer')
      return 'Your team owner manages usage credits. Ask them to add credits.';
    const amount = amountCents();
    if (amount === undefined)
      return 'Enter an amount greater than $0, using at most two decimal places.';
    if (!props.context.checkout.supportedAmounts().includes(amount))
      return 'Custom credit amounts are not available yet. Choose $25, $50, or $100.';
  };
  const checkout = async () => {
    const amount = amountCents();
    if (notice() || amount === undefined || props.context.checkout.pending())
      return;
    setError(undefined);
    try {
      const url = await props.context.checkout.start(amount);
      props.context.navigateToPayment(url);
    } catch (error) {
      const needsPlan = thrownResultErrorHasCode(error, 'PAID_PLAN_REQUIRED');
      setSubscriptionRequired(needsPlan);
      setError(
        needsPlan
          ? 'Subscribe to a paid plan to buy additional usage credits.'
          : "Couldn't start checkout. Please try again."
      );
    }
  };
  return (
    <CreditPurchaseDialog
      selection={selection()}
      customAmount={customAmount()}
      amountCents={amountCents()}
      onSelect={(value) => {
        setSelection(value);
        setError(undefined);
      }}
      onCustomAmount={setCustomAmount}
      onClose={props.onClose}
      onRestoreFocus={props.onRestoreFocus}
      onCheckout={() => void checkout()}
      onViewPlans={
        (props.context.summary()?.billingAccess === 'free' && !previewing()) ||
        subscriptionRequired()
          ? () => {
              props.onClose();
              props.context.openPlans();
            }
          : undefined
      }
      pending={props.context.checkout.pending()}
      disabled={!!notice()}
      notice={notice()}
      error={error()}
    />
  );
}
