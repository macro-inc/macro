import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import { createSignal } from 'solid-js';
import { CreditPurchaseDialog } from '../components/credit-purchase-dialog';
import type { UsageContext } from '../context/usage-context';
import { formatCreditBalance, parseDollarInput } from '../core/usage';

/** The server's reason for a refused purchase, as a sentence. */
function purchaseRejection(error: unknown) {
  const message =
    error instanceof ThrownResultError &&
    error.errors.find((e) => e.code === 'CREDIT_PURCHASE_REJECTED')?.message;
  return message
    ? `${message.charAt(0).toUpperCase()}${message.slice(1)}.`
    : "Couldn't buy credits. Please try again.";
}

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
    props.context.developer?.active() || props.context.autoReload.preview();
  const teamCard = () =>
    props.context.summary()?.billingAccess === 'team-member';
  const notice = () => {
    if (previewing())
      return 'Credit purchases are disabled during the developer preview.';
    const summary = props.context.summary();
    if (summary?.unlimited)
      return 'Your plan includes unlimited AI usage. No additional credits are needed.';
    if (summary?.billingAccess === 'free')
      return 'Subscribe to a paid plan to buy additional usage credits.';
    const amount = amountCents();
    if (amount === undefined)
      return 'Enter an amount greater than $0, using at most two decimal places.';
    if (!props.context.creditPurchase.supportedAmounts().includes(amount))
      return 'Custom credit amounts are not available yet. Choose $25, $50, or $100.';
    const limit = summary?.purchaseLimit;
    if (limit && amount > limit.remainingCents)
      return `${formatCreditBalance(limit.remainingCents)} of ${teamCard() ? "your team's" : 'your'} ${formatCreditBalance(limit.limitCents)} monthly credit limit is left. ${teamCard() ? 'Ask your team owner to raise it.' : 'Raise it in Automatic reload settings.'}`;
  };
  /** The card on file can't be charged off-session (none on file, or it
   * needs 3-D Secure): the payer pays this pack through Stripe Checkout. */
  const checkout = async (
    amount: number,
    reason: 'payment_method_required' | 'authentication_required'
  ) => {
    if (teamCard()) {
      setError(
        reason === 'payment_method_required'
          ? "Your team doesn't have a card on file. Ask your team owner to add one."
          : "Your team's card needs verification. Ask your team owner to buy credits or update the card."
      );
      return;
    }
    try {
      props.context.navigateToPayment(
        await props.context.creditPurchase.checkout(amount)
      );
    } catch {
      setError("Couldn't open checkout. Please try again.");
    }
  };
  const buy = async () => {
    const amount = amountCents();
    if (
      notice() ||
      amount === undefined ||
      props.context.creditPurchase.pending()
    )
      return;
    setError(undefined);
    try {
      const status = await props.context.creditPurchase.buy(amount);
      if (
        status === 'payment_method_required' ||
        status === 'authentication_required'
      ) {
        await checkout(amount, status);
        return;
      }
      if (status === 'declined') {
        setError(
          teamCard()
            ? "Your team's card was declined. Ask your team owner to update it."
            : 'Your card was declined. Update your payment method, then try again.'
        );
        return;
      }
      props.onClose();
      toast.success(`Added ${formatCreditBalance(amount)} in credits.`);
    } catch (error) {
      const needsPlan = thrownResultErrorHasCode(error, 'PAID_PLAN_REQUIRED');
      setSubscriptionRequired(needsPlan);
      setError(
        needsPlan
          ? 'Subscribe to a paid plan to buy additional usage credits.'
          : purchaseRejection(error)
      );
    }
  };
  return (
    <CreditPurchaseDialog
      sharedWithTeam={props.context.summary()?.creditScope === 'team'}
      teamCard={teamCard()}
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
      onBuy={() => fireAndForget(buy(), 'usage')}
      onViewPlans={
        (props.context.summary()?.billingAccess === 'free' && !previewing()) ||
        subscriptionRequired()
          ? () => {
              props.onClose();
              props.context.openPlans();
            }
          : undefined
      }
      pending={props.context.creditPurchase.pending()}
      disabled={!!notice()}
      notice={notice()}
      error={error()}
    />
  );
}
