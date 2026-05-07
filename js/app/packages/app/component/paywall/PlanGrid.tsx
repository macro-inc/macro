import { For, type JSX, Show } from 'solid-js';
import { PLAN_FEATURES, PLANS, type Plan, type PlanTier } from './plans';

interface PlanGridProps {
  /** The currently highlighted tier — shows accent styling. */
  highlightedTier?: () => PlanTier | undefined;
  /** Render a footer (e.g. button) below the feature rows for each plan column. */
  footer?: (plan: Plan) => JSX.Element;
}

export function PlanGrid(props: PlanGridProps) {
  const isHighlighted = (plan: Plan) =>
    plan.highlighted || props.highlightedTier?.() === plan.tier;

  return (
    <div class="w-full overflow-x-auto">
      <table class="w-full min-w-small text-sm border-separate border-spacing-0 table-fixed">
        <thead>
          <tr>
            <th class="p-4 w-40" aria-hidden="true" />
            <For each={PLANS}>
              {(plan) => (
                <th
                  scope="col"
                  class="p-4 text-left align-top"
                  classList={{
                    'bg-accent/5 border-t border-x border-accent':
                      isHighlighted(plan),
                  }}
                >
                  <div class="flex flex-col gap-2">
                    <span class="text-xl font-semibold text-ink">
                      {plan.name}
                    </span>
                    <span class="flex items-baseline gap-0.5">
                      <span class="text-3xl font-bold text-ink">
                        ${plan.price}
                      </span>
                      <span class="text-base text-ink/40">/mo</span>
                    </span>
                  </div>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={PLAN_FEATURES}>
            {(feature) => (
              <tr>
                <th
                  scope="row"
                  class="px-4 py-3 text-left font-normal text-ink/60 border-t border-edge-muted"
                >
                  {feature.label}
                </th>
                <For each={PLANS}>
                  {(plan) => (
                    <td
                      class="px-4 py-3 text-ink"
                      classList={{
                        'bg-accent/5 border-x border-accent':
                          isHighlighted(plan),
                        'border-t border-edge-muted': !isHighlighted(plan),
                      }}
                    >
                      {feature.values[plan.tier]}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
        <Show when={props.footer}>
          {(footerRender) => (
            <tfoot>
              <tr>
                <td class="p-4 border-t border-edge-muted" />
                <For each={PLANS}>
                  {(plan) => (
                    <td
                      class="p-4 align-bottom"
                      classList={{
                        'bg-accent/5 border-x border-b border-accent':
                          isHighlighted(plan),
                        'border-t border-edge-muted': !isHighlighted(plan),
                      }}
                    >
                      {footerRender()(plan)}
                    </td>
                  )}
                </For>
              </tr>
            </tfoot>
          )}
        </Show>
      </table>
    </div>
  );
}
