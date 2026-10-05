import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import {
  useAiBillingPlansQuery,
  useAiBillingSummaryQuery,
  useCreateAiCreditCheckoutMutation,
  useCreateBillingPortalMutation,
  useUpdateAiOverageMutation,
} from '@queries/auth';
import { createSignal, Suspense } from 'solid-js';
import { useAiUsagePreview } from '../paywall/ai-usage-preview';
import type { UsageContext } from './context/usage-context';
import { type AutoReloadSettings, DEFAULT_AUTO_RELOAD } from './core/usage';
import { toUsageSummary } from './queries/usage-summary';
import { UsageSettingsView } from './views/usage-settings';

export function Usage() {
  const summary = useAiBillingSummaryQuery();
  const plans = useAiBillingPlansQuery();
  const checkout = useCreateAiCreditCheckoutMutation();
  const portal = useCreateBillingPortalMutation();
  const overage = useUpdateAiOverageMutation();
  const usagePreview = useAiUsagePreview();
  const { showUsageLimit, hideUsageLimit } = useAiUsageLimitState();
  const { openSettings } = useSettingsState();
  const [autoReloadPreview, setAutoReloadPreview] = createSignal(false);
  const [previewSettings, setPreviewSettings] =
    createSignal<AutoReloadSettings>({ ...DEFAULT_AUTO_RELOAD });
  const previewing = () => usagePreview.active() || autoReloadPreview();
  const returnUrl = `${window.location.origin}/app/settings/usage`;
  const context: UsageContext = {
    summary: () => {
      const snapshot = usagePreview.withPreview(
        summary.isSuccess ? summary.data : undefined
      );
      return snapshot ? toUsageSummary(snapshot) : undefined;
    },
    loading: () => summary.isPending,
    failed: () => summary.isError,
    refresh: () => {
      void summary.refetch();
    },
    checkout: {
      pending: () => checkout.isPending,
      supportedAmounts: () =>
        plans.isSuccess
          ? plans.data.credit_packs_cents
          : [1_000, 2_500, 5_000, 10_000],
      start: async (amountCents) => {
        if (
          previewing() ||
          !summary.isSuccess ||
          summary.data.tier === 'free' ||
          !summary.data.can_manage_billing
        )
          throw new Error('Credit purchase unavailable');
        return await checkout.mutateAsync({
          amountCents,
          successUrl: `${returnUrl}?aiCreditsSuccess=true`,
          cancelUrl: `${returnUrl}?aiCreditsCancel=true`,
        });
      },
    },
    autoReload: {
      settings: () =>
        autoReloadPreview() ? previewSettings() : DEFAULT_AUTO_RELOAD,
      available: () => DEV_MODE_ENV && autoReloadPreview(),
      pending: () => false,
      preview: autoReloadPreview,
      save: async (settings) => {
        // No auto-reload API exists yet. Only the explicit development preview can save.
        if (!DEV_MODE_ENV || !autoReloadPreview())
          throw new Error('Auto-Reload unavailable');
        setPreviewSettings(settings);
      },
    },
    paymentMethods: {
      pending: () => portal.isPending,
      open: async () => {
        if (
          previewing() ||
          !summary.isSuccess ||
          summary.data.tier === 'free' ||
          !summary.data.can_manage_billing
        )
          throw new Error('Payment methods unavailable');
        return await portal.mutateAsync({ returnUrl });
      },
    },
    navigateToPayment: (url) => {
      window.location.href = url;
    },
    openPlans: () => openSettings('Billing'),
    existingUsageBilling: {
      pending: () => overage.isPending,
      turnOff: async () => {
        if (
          previewing() ||
          !summary.isSuccess ||
          summary.data.tier === 'free' ||
          !summary.data.can_manage_billing
        )
          throw new Error('Usage billing unavailable');
        await overage.mutateAsync({
          enabled: false,
          limitCents: summary.data.overage_limit_cents,
        });
      },
    },
    developer: DEV_MODE_ENV
      ? {
          exhausted: usagePreview.active,
          simulateExhausted: () => usagePreview.setActive(true),
          openLimitDialog: () => showUsageLimit('ai_allowance_exhausted'),
          previewAutoReload: () => setAutoReloadPreview(true),
          reset: () => {
            usagePreview.setActive(false);
            setAutoReloadPreview(false);
            setPreviewSettings({ ...DEFAULT_AUTO_RELOAD });
            hideUsageLimit();
          },
        }
      : undefined,
  };
  return (
    <Suspense fallback={<p role="status">Loading usage…</p>}>
      <UsageSettingsView context={context} />
    </Suspense>
  );
}
