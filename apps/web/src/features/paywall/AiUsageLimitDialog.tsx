import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import {
  enableAiUsageBilling,
  LOCAL_ONLY,
  PROD_MODE_ENV,
} from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { fireAndForget } from '@core/util/fireAndForget';
import { isTauri } from '@core/util/platform';
import { ThrownResultError } from '@core/util/result';
import { getWebOrigin } from '@core/util/webOrigin';
import {
  useAiBillingPlansQuery,
  useAiBillingSummaryQuery,
  useCreateAiCreditCheckoutMutation,
  useCreateBillingPortalMutation,
  usePurchaseAiCreditsMutation,
  useUpdateAiAutoReloadMutation,
} from '@queries/auth';
import { queryReadyGate } from '@queries/gate';
import { createSignal, Suspense } from 'solid-js';
import {
  formatCreditBalance,
  isUsageAvailable,
  parseDollarInput,
  validateAutoReload,
} from '../usage/core/usage';
import { toUsageSummary } from '../usage/queries/usage-summary';
import { useAiUsagePreview } from './ai-usage-preview';
import {
  AiUsageLimitDialogView,
  type PurchaseMode,
} from './components/ai-usage-limit-dialog';

/** The server's reason for a refused purchase, as a sentence. */
function purchaseRejection(error: unknown) {
  const message =
    error instanceof ThrownResultError &&
    error.errors.find((e) => e.code === 'CREDIT_PURCHASE_REJECTED')?.message;
  return message
    ? `${message.charAt(0).toUpperCase()}${message.slice(1)}.`
    : "Couldn't buy credits. Please try again.";
}

/**
 * Shown when the backend refuses an AI request with a billing code. Offers
 * paid subscriptions to Free users. Paid users can buy credits once on the
 * card on file (a team member on the team's card, within its monthly credit
 * limit), and the payer can turn on Auto-Reload in one click.
 */
export function AiUsageLimitDialog() {
  const { usageLimitOpen, usageLimitCode, hideUsageLimit } =
    useAiUsageLimitState();
  const { openSettings } = useSettingsState();
  const summary = useAiBillingSummaryQuery({ enabled: usageLimitOpen });
  const plans = useAiBillingPlansQuery();
  const aiUsageBilling = useFeatureFlag(enableAiUsageBilling);
  const usagePreview = useAiUsagePreview();
  const autoReload = useUpdateAiAutoReloadMutation();
  const portal = useCreateBillingPortalMutation();
  const purchase = usePurchaseAiCreditsMutation();
  const checkout = useCreateAiCreditCheckoutMutation();
  const [creditsDeclined, setCreditsDeclined] = createSignal(false);
  const [mode, setMode] = createSignal<PurchaseMode>('credits');
  /** The chosen credit pack; unset shows the smallest. */
  const [packCents, setPackCents] = createSignal<number>();
  const [paymentFailed, setPaymentFailed] = createSignal(false);
  const [offerError, setOfferError] = createSignal<string>();
  /** The payer's edit to the monthly limit; unset shows the plan default. */
  const [monthlyLimitInput, setMonthlyLimitInput] = createSignal<string>();
  const available = () =>
    !usagePreview.beforeLaunch() &&
    isUsageAvailable(PROD_MODE_ENV && !LOCAL_ONLY, aiUsageBilling().enabled);
  const usageSnapshot = () =>
    usagePreview.withPreview(
      queryReadyGate(summary) ? summary.data : undefined
    );
  const freePlan = () =>
    usageLimitCode() === 'ai_free_allowance_exhausted' ||
    usageSnapshot()?.tier === 'free';

  const close = () => {
    hideUsageLimit();
    setPaymentFailed(false);
    setOfferError(undefined);
    setMonthlyLimitInput(undefined);
    setMode('credits');
    setPackCents(undefined);
    setCreditsDeclined(false);
  };

  /** A paid user's position and the plan catalog, when they can buy more. */
  const buyer = () => {
    // The plan catalog supplies credit packs and Auto-Reload's starting values.
    if (
      usagePreview.active() ||
      !queryReadyGate(summary) ||
      !queryReadyGate(plans)
    )
      return;
    const snapshot = summary.data;
    if (snapshot.tier === 'free' || snapshot.unlimited) return;
    return { snapshot, catalog: plans.data };
  };

  /** The monthly credit limit on one-time purchases and what is left of it. */
  const purchaseLimit = () => {
    const limit = buyer()?.snapshot.credit_purchase;
    if (!limit || limit.monthly_limit_cents == null) return;
    return {
      limitCents: limit.monthly_limit_cents,
      remainingCents: Math.max(
        0,
        limit.monthly_limit_cents - limit.committed_cents
      ),
    };
  };

  /** The payer's starting thresholds, when one click can turn Auto-Reload on. */
  const autoReloadSettings = () => {
    const current = buyer();
    // Only the payer turns Auto-Reload on. Keep the offer while a failed
    // charge is shown: a declined reload leaves Auto-Reload active with its
    // invoice still open.
    if (
      !current?.snapshot.can_manage_billing ||
      (current.snapshot.auto_reload?.active && !paymentFailed())
    )
      return;
    return toUsageSummary(current.snapshot, current.catalog).autoReload
      .settings;
  };

  /** The chosen pack, else the smallest; a pack over the limit is never kept. */
  const selectedPack = () => {
    const packs = buyer()?.catalog.credit_packs_cents ?? [];
    const remaining = purchaseLimit()?.remainingCents;
    const fits = (cents: number) =>
      remaining === undefined || cents <= remaining;
    const chosen = packCents();
    return chosen !== undefined && fits(chosen)
      ? chosen
      : (packs.find(fits) ?? packs[0]);
  };

  /** The card on file can't be charged off-session (none on file, or it
   * needs 3-D Secure): the payer pays this pack through Stripe Checkout. */
  const checkoutCredits = async (
    amountCents: number,
    reason: 'payment_method_required' | 'authentication_required'
  ) => {
    if (!usageSnapshot()?.can_manage_billing) {
      setOfferError(
        reason === 'payment_method_required'
          ? "Your team doesn't have a card on file. Ask your team owner to add one."
          : "Your team's card needs verification. Ask your team owner to buy credits or update the card."
      );
      return;
    }
    // Come back to this page so the user can resend from where they were. The
    // native app's own origin isn't a URL Stripe can return to.
    const here = isTauri()
      ? `${getWebOrigin()}/app/settings/usage`
      : window.location.href;
    try {
      window.location.href = await checkout.mutateAsync({
        amountCents,
        successUrl: here,
        cancelUrl: here,
      });
    } catch {
      setOfferError("Couldn't open checkout. Please try again.");
    }
  };

  const buyCredits = async () => {
    const amountCents = selectedPack();
    if (amountCents === undefined || purchase.isPending || checkout.isPending)
      return;
    setOfferError(undefined);
    try {
      const result = await purchase.mutateAsync({ amountCents });
      if (
        result.status === 'payment_method_required' ||
        result.status === 'authentication_required'
      ) {
        await checkoutCredits(amountCents, result.status);
        return;
      }
      if (result.status === 'declined') {
        setCreditsDeclined(true);
        return;
      }
      close();
      toast.success(
        `Added ${formatCreditBalance(result.amountCents)} in credits. Resend your message.`
      );
    } catch (error) {
      setOfferError(purchaseRejection(error));
    }
  };

  const monthlyLimit = () => {
    const input = monthlyLimitInput();
    if (input !== undefined) return input;
    const limit = autoReloadSettings()?.monthlySpendLimitCents;
    return limit === null || limit === undefined ? '' : String(limit / 100);
  };

  /** Saved thresholds with the payer's monthly limit; blank means no limit. */
  const chosenSettings = () => {
    const settings = autoReloadSettings();
    if (!settings) return;
    const text = monthlyLimit().trim();
    const monthlySpendLimitCents = text ? parseDollarInput(text) : null;
    if (monthlySpendLimitCents === undefined)
      return {
        error: 'Enter a monthly spend limit in dollars, or leave it blank.',
      };
    const chosen = { ...settings, monthlySpendLimitCents, enabled: true };
    const error = validateAutoReload(chosen);
    return error ? { error } : { settings: chosen };
  };

  const turnOnAutoReload = async () => {
    const chosen = chosenSettings();
    if (!chosen || autoReload.isPending) return;
    if ('error' in chosen) {
      setOfferError(chosen.error);
      return;
    }
    setOfferError(undefined);
    try {
      const snapshot = await autoReload.mutateAsync(chosen.settings);
      // Enabling reloads right away when the balance is low. A failed charge
      // comes back as a suspended reload, and a declined one as an open
      // invoice, so only usable credits mean the user can resend.
      if (snapshot.auto_reload?.suspended || snapshot.remaining_cents <= 0) {
        setPaymentFailed(true);
        return;
      }
      close();
      toast.success('Auto-reload is on. Resend your message.');
    } catch {
      setOfferError("Couldn't turn on auto-reload. Please try again.");
    }
  };

  const addPaymentMethod = async () => {
    if (portal.isPending) return;
    try {
      window.location.href = await portal.mutateAsync({
        returnUrl: `${getWebOrigin()}/app/settings/usage`,
      });
    } catch {
      setOfferError("Couldn't open payment methods. Please try again.");
    }
  };

  const offer = () => {
    const current = buyer();
    const pack = selectedPack();
    if (!current || pack === undefined) return;
    const settings = autoReloadSettings();
    return {
      mode: settings ? mode() : ('credits' as const),
      packsCents: current.catalog.credit_packs_cents,
      packCents: pack,
      teamCard: !current.snapshot.can_manage_billing,
      limit: purchaseLimit(),
      creditsDeclined: creditsDeclined(),
      autoReload: settings && {
        minimumBalanceCents: settings.minimumBalanceCents,
        targetBalanceCents: settings.targetBalanceCents,
        monthlyLimit: monthlyLimit(),
        paymentFailed: paymentFailed(),
      },
      pending:
        autoReload.isPending ||
        portal.isPending ||
        purchase.isPending ||
        checkout.isPending,
      error: offerError(),
    };
  };

  return (
    <Suspense fallback={null}>
      <AiUsageLimitDialogView
        open={usageLimitOpen() && available()}
        code={usageLimitCode() ?? undefined}
        freePlan={freePlan()}
        resetsAt={usageSnapshot()?.period_end}
        offer={offer()}
        previewNotice={
          usagePreview.active()
            ? `Developer preview: ${usagePreview.plan() === 'free' ? 'Free' : 'paid'} plan. No account billing has changed.`
            : undefined
        }
        onClose={close}
        onOpenSettings={() => {
          const target = freePlan() ? 'Billing' : 'Usage';
          close();
          openSettings(target);
        }}
        onMode={(next) => {
          setOfferError(undefined);
          setMode(next);
        }}
        onPack={(cents) => {
          setOfferError(undefined);
          setPackCents(cents);
        }}
        onBuyCredits={() => fireAndForget(buyCredits(), 'usage')}
        onMonthlyLimit={(value) => {
          setOfferError(undefined);
          setMonthlyLimitInput(value);
        }}
        onTurnOnAutoReload={() => fireAndForget(turnOnAutoReload(), 'usage')}
        onAddPaymentMethod={() => fireAndForget(addPaymentMethod(), 'usage')}
      />
    </Suspense>
  );
}
