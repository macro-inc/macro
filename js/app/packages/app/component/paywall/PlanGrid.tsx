import { For, type JSX } from 'solid-js';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { PLANS, type Plan, type PlanTier } from './plans';

interface PlanGridProps {
  /** The currently highlighted tier — shows accent border. */
  highlightedTier?: () => PlanTier | undefined;
  /** Render a footer (e.g. button) below the features for each plan card. */
  footer?: (plan: Plan) => JSX.Element;
}

export function PlanGrid(props: PlanGridProps) {
  return (
    <div
      class="w-full max-w-2xl items-start"
      classList={{
        'flex flex-col gap-3': isTouchDevice(),
        'flex gap-4': !isTouchDevice(),
      }}
    >
      <For each={PLANS}>
        {(plan) => {
          const isHighlighted = () =>
            plan.highlighted || props.highlightedTier?.() === plan.tier;

          return (
            <div class="flex-1 flex flex-col">
              <div
                class="border bg-panel rounded-xs flex flex-col overflow-hidden w-full"
                classList={{
                  'border-accent ring-1 ring-accent': isHighlighted(),
                  'border-edge-muted': !isHighlighted(),
                }}
              >
                <div class="p-4 flex flex-col gap-3 flex-1 w-full">
                  <div>
                    <h3 class="text-xl font-semibold text-ink">{plan.name}</h3>
                  </div>
                  <div class="flex items-baseline gap-0.5">
                    <span class="text-4xl font-bold text-ink">
                      ${plan.price}
                    </span>
                    <span class="text-base text-ink/40">/mo</span>
                  </div>
                  <ul class="text-sm text-ink/60 flex flex-col gap-1 list-disc list-inside">
                    <For each={plan.features}>
                      {(feature) => <li>{feature}</li>}
                    </For>
                  </ul>
                  {props.footer?.(plan)}
                </div>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
