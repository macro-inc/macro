import { PLAN_BY_TIER, type PlanTier } from '@app/features/paywall/plans';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CreditCardIcon from '@phosphor/credit-card.svg';
import { Show } from 'solid-js';
import { IntegrationRow, SettingsCard } from '../primitives';

/** The current plan as a card that opens Billing settings. */
export function CurrentPlanCard(props: {
  /** Undefined while the plan is loading. */
  tier?: PlanTier;
  onOpen: () => void;
}) {
  return (
    <SettingsCard>
      <button
        type="button"
        class="w-full rounded-[inherit] text-left outline-none hover:bg-ink/4 focus-visible:bg-ink/6 focus-visible:inset-ring-2 focus-visible:inset-ring-accent"
        onClick={() => props.onOpen()}
      >
        <IntegrationRow
          icon={<CreditCardIcon />}
          title={
            <Show when={props.tier} fallback="Loading plan…">
              {(tier) => `${PLAN_BY_TIER[tier()].name} plan`}
            </Show>
          }
          description="See your plan and billing details"
        >
          <CaretRightIcon class="size-4 text-ink-extra-muted" />
        </IntegrationRow>
      </button>
    </SettingsCard>
  );
}
