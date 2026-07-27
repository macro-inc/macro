import {
  PLAN_FEATURES,
  PLANS,
  type PlanTier,
} from '@app/features/paywall/plans';
import ArrowRight from '@phosphor/arrow-right.svg';
import Check from '@phosphor/check.svg';
import { Button, cn } from '@ui';
import { createSignal, Index, Show } from 'solid-js';
import { SkipButton } from './shared';

/** Free vs paid. The last step: continuing or skipping marks onboarding
 * complete; skippers land exactly where finishers do. */
export function PlanStep(props: {
  finishing: boolean;
  onFree: (planSkipped: boolean) => void;
  onPremium: (tier: Exclude<PlanTier, 'free'>) => void;
}) {
  const [selected, setSelected] = createSignal<PlanTier>('free');

  const finish = () => {
    const tier = selected();
    if (tier === 'free') props.onFree(false);
    else props.onPremium(tier);
  };

  return (
    <div class="flex flex-col gap-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Index each={PLANS}>
          {(plan) => (
            <button
              type="button"
              onClick={() => setSelected(plan().tier)}
              class={cn(
                'flex flex-col gap-4 rounded-xl border p-5 text-left transition-colors cursor-default',
                selected() === plan().tier
                  ? 'border-ink/40 ring-1 ring-ink/20'
                  : 'border-edge hover:border-edge-muted'
              )}
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-ink">
                  {plan().name}
                </span>
                <span
                  class={cn(
                    'flex items-center justify-center size-4 rounded-full border',
                    selected() === plan().tier
                      ? 'border-ink bg-ink text-surface'
                      : 'border-edge'
                  )}
                >
                  <Show when={selected() === plan().tier}>
                    <Check class="size-3" />
                  </Show>
                </span>
              </div>
              <div class="flex items-baseline gap-1">
                <span class="text-2xl font-semibold tracking-tight text-ink">
                  ${plan().price}
                </span>
                <span class="text-xs text-ink-muted">
                  {plan().price === 0 ? 'forever' : 'per user / month'}
                </span>
              </div>
              <ul class="flex flex-col gap-2">
                <Index each={PLAN_FEATURES}>
                  {(feature) => (
                    <li class="flex items-center justify-between gap-2 text-xs">
                      <span class="text-ink-muted">{feature().label}</span>
                      <span class="text-ink font-medium">
                        {feature().values[plan().tier]}
                      </span>
                    </li>
                  )}
                </Index>
              </ul>
            </button>
          )}
        </Index>
      </div>

      <div class="flex flex-col gap-3">
        <Button variant="cta" disabled={props.finishing} onClick={finish}>
          {props.finishing
            ? 'Setting up your workspace…'
            : `Continue with ${selected() === 'free' ? 'Free' : 'Premium'}`}
          <ArrowRight class="size-4" />
        </Button>
        <SkipButton
          label="Decide later"
          disabled={props.finishing}
          onClick={() => props.onFree(true)}
        />
      </div>
    </div>
  );
}
