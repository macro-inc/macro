import { AiUsageControls, AiUsageMeter } from '@app/features/settings/AiUsage';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import { useAiBillingSummaryQuery, useChangePlanMutation } from '@queries/auth';
import type { AiDenyCode } from '@service-auth/ai-billing-types';
import { useNavigate } from '@solidjs/router';
import { Button, Dialog, Surface } from '@ui';
import { Show } from 'solid-js';

const TITLES: Record<AiDenyCode, string> = {
  ai_allowance_exhausted: "You've used this month's included AI",
  ai_overage_limit_reached: "You've hit your AI spending limit",
  ai_overage_payment_failed: 'Your last AI usage charge failed',
};

/**
 * Shown when the backend refuses an AI request with a billing code. Offers the
 * payer the same controls as Billing settings, right where they were blocked.
 */
export function AiUsageLimitDialog() {
  const { usageLimitOpen, usageLimitCode, hideUsageLimit } =
    useAiUsageLimitState();
  const analytics = useAnalytics();
  const navigate = useNavigate();
  const summary = useAiBillingSummaryQuery({ enabled: usageLimitOpen });
  const changePlan = useChangePlanMutation();

  const title = () => TITLES[usageLimitCode() ?? 'ai_allowance_exhausted'];
  const returnUrl = () => `${window.location.origin}/app/settings/billing`;

  const upgradeToMax = async () => {
    try {
      await changePlan.mutateAsync({ plan: 'max' });
      analytics.track('plan_changed', { plan: 'max', from: 'usage_limit' });
      toast.success('Upgraded to Max. Send your message again.');
      hideUsageLimit();
    } catch (error) {
      console.error(error);
      toast.failure("Couldn't upgrade. Please try again from Billing.");
    }
  };

  return (
    <Dialog
      open={usageLimitOpen()}
      onOpenChange={(open) => !open && hideUsageLimit()}
      position="center"
      class="w-160"
    >
      <Surface depth={2} class="rounded-xl">
        <section class="flex flex-col gap-5 p-6 font-sans">
          <div class="flex flex-col gap-1">
            <h2 class="text-xl font-semibold text-ink">{title()}</h2>
            <p class="text-sm text-ink-extra-muted">
              Your plan includes AI each month at Macro's usage rates. Add
              credits or turn on usage billing to keep going now, or move to Max
              for five times the included usage.
            </p>
          </div>

          <Show when={summary.isSuccess && summary.data}>
            {(snapshot) => (
              <div class="flex flex-col gap-4 rounded-lg bg-active p-4">
                <AiUsageMeter snapshot={snapshot()} />
                <div class="border-t border-t-edge-muted pt-4">
                  <AiUsageControls
                    snapshot={snapshot()}
                    returnUrl={returnUrl()}
                  />
                </div>
              </div>
            )}
          </Show>

          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              depth={3}
              class="rounded-full px-3 py-1.5"
              onClick={() => {
                hideUsageLimit();
                navigate('/app/settings/billing');
              }}
            >
              Open billing settings
            </Button>
            <div class="flex gap-2 sm:justify-end">
              <Button
                variant="ghost"
                depth={3}
                class="rounded-full px-3 py-1.5"
                onClick={hideUsageLimit}
              >
                Dismiss
              </Button>
              <Show
                when={
                  summary.isSuccess &&
                  summary.data.can_manage_billing &&
                  summary.data.tier === 'premium'
                }
              >
                <Button
                  variant="cta"
                  class="rounded-full px-3 py-1.5"
                  disabled={changePlan.isPending}
                  onClick={() => void upgradeToMax()}
                >
                  Upgrade to Max
                </Button>
              </Show>
            </div>
          </div>
        </section>
      </Surface>
    </Dialog>
  );
}
