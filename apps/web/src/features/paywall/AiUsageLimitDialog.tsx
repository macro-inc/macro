import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import { useSettingsState } from '@core/constant/SettingsState';
import { useAiBillingSummaryQuery } from '@queries/auth';
import type { AiDenyCode } from '@service-auth/ai-billing-types';
import { Button, Dialog, Surface } from '@ui';
import { Show, Suspense } from 'solid-js';
import { MonthlyLimit } from '../usage/components/monthly-limit';
import { monthlyUsagePercent } from '../usage/core/usage';
import { useAiUsagePreview } from './ai-usage-preview';

const TITLES: Record<AiDenyCode, string> = {
  ai_allowance_exhausted: "You've used this month's included AI",
  ai_free_allowance_exhausted: "You've used this month's free AI",
  ai_overage_limit_reached: "You've hit your AI spending limit",
  ai_overage_payment_failed: 'Your last AI usage charge failed',
};

/**
 * Shown when the backend refuses an AI request with a billing code. Shows the
 * monthly limit and offers paid subscriptions to Free users or usage credits
 * to paid users.
 */
export function AiUsageLimitDialog() {
  const { usageLimitOpen, usageLimitCode, hideUsageLimit } =
    useAiUsageLimitState();
  const { openSettings } = useSettingsState();
  const summary = useAiBillingSummaryQuery({ enabled: usageLimitOpen });
  const usagePreview = useAiUsagePreview();
  const usageSnapshot = () =>
    usagePreview.withPreview(summary.isSuccess ? summary.data : undefined);
  const freePlan = () =>
    usageLimitCode() === 'ai_free_allowance_exhausted' ||
    usageSnapshot()?.tier === 'free';

  const title = () => TITLES[usageLimitCode() ?? 'ai_allowance_exhausted'];

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
            <Dialog.Title class="text-xl font-semibold text-ink">
              {title()}
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-extra-muted">
              {freePlan()
                ? 'Subscribe to a paid plan to keep going.'
                : usageSnapshot()
                  ? 'Add additional credits to keep going.'
                  : 'Check your plan and usage options to keep going.'}
            </Dialog.Description>
          </div>

          <Show when={usagePreview.active()}>
            <p class="text-xs text-ink-muted" role="status">
              Developer preview: 100% usage. No account billing has changed.
            </p>
          </Show>

          {/* The summary is a suspending query resource; keep its
              suspension inside the dialog rather than the route boundary. */}
          <Suspense fallback={null}>
            <Show when={usageSnapshot()}>
              {(snapshot) => (
                <div class="flex flex-col gap-4 rounded-lg bg-active p-4">
                  <MonthlyLimit
                    percentage={monthlyUsagePercent(
                      snapshot().used_cents,
                      snapshot().included_cents
                    )}
                    periodEnd={snapshot().period_end}
                    unlimited={snapshot().unlimited}
                  />
                </div>
              )}
            </Show>
          </Suspense>

          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant={freePlan() ? 'accent' : 'ghost'}
              depth={3}
              class="px-3 py-1.5"
              onClick={() => {
                const target = freePlan() ? 'Billing' : 'Usage';
                hideUsageLimit();
                openSettings(target);
              }}
            >
              {freePlan() ? 'View plans' : 'Open usage settings'}
            </Button>
            <div class="flex gap-2 sm:justify-end">
              <Button
                variant="ghost"
                depth={3}
                class="px-3 py-1.5"
                onClick={hideUsageLimit}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </section>
      </Surface>
    </Dialog>
  );
}
