import type { AiDenyCode } from '@service-auth/ai-billing-types';
import { Button, Dialog, Surface } from '@ui';
import { Show, Suspense } from 'solid-js';
import { MonthlyLimit } from '../../usage/components/monthly-limit';

const TITLES: Record<AiDenyCode, string> = {
  ai_allowance_exhausted: "You've used this month's included AI",
  ai_free_allowance_exhausted: "You've used this month's free AI",
  ai_overage_limit_reached: "You've hit your AI spending limit",
  ai_overage_payment_failed: 'Your last AI usage charge failed',
};

export type AiUsageLimitDialogProps = {
  open: boolean;
  code?: AiDenyCode;
  freePlan: boolean;
  usage?: { percentage: number; periodEnd: string; unlimited: boolean };
  previewNotice?: string;
  onClose: () => void;
  onOpenSettings: () => void;
};

export function AiUsageLimitDialogView(props: AiUsageLimitDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      class="w-160"
    >
      <Surface depth={2} class="rounded-xl">
        <section class="flex flex-col gap-5 p-6 font-sans">
          <div class="flex flex-col gap-1">
            <Dialog.Title class="text-xl font-semibold text-ink">
              {TITLES[props.code ?? 'ai_allowance_exhausted']}
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-extra-muted">
              {props.freePlan
                ? 'Subscribe to a paid plan to keep going.'
                : props.usage
                  ? 'Add additional credits to keep going.'
                  : 'Check your plan and usage options to keep going.'}
            </Dialog.Description>
          </div>

          <Show when={props.previewNotice}>
            <p class="text-xs text-ink-muted" role="status">
              {props.previewNotice}
            </p>
          </Show>

          {/* The summary is a suspending query resource; keep its
              suspension inside the dialog rather than the route boundary. */}
          <Suspense fallback={null}>
            <Show when={props.usage}>
              {(snapshot) => (
                <div class="flex flex-col gap-4 rounded-lg bg-active p-4">
                  <MonthlyLimit
                    percentage={snapshot().percentage}
                    periodEnd={snapshot().periodEnd}
                    unlimited={snapshot().unlimited}
                  />
                </div>
              )}
            </Show>
          </Suspense>

          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant={props.freePlan ? 'accent' : 'ghost'}
              depth={3}
              class="px-3 py-1.5"
              onClick={props.onOpenSettings}
            >
              {props.freePlan ? 'View plans' : 'Open usage settings'}
            </Button>
            <div class="flex gap-2 sm:justify-end">
              <Button
                variant="ghost"
                depth={3}
                class="px-3 py-1.5"
                onClick={props.onClose}
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
