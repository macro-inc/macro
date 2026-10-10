import { PLANS } from '@app/features/paywall/plans';
import type { CollectionNode } from '@kobalte/core';
import { Select } from '@kobalte/core/select';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import { Button } from '@ui';
import { Show } from 'solid-js';

type PlanOption = { value: PaidPlan; label: string; description: string };

/** Every paid plan a seat can be moved to, cheapest first. */
function planOptionsFor(aiUsageBilling: boolean): PlanOption[] {
  return PLANS.flatMap((plan) =>
    plan.tier === 'free'
      ? []
      : [
          {
            value: plan.tier,
            label: plan.name,
            description: `$${plan.price}${aiUsageBilling && plan.tier === 'max' ? ' · 10× usage' : ''}`,
          },
        ]
  );
}

export function TeamSeatPlanSelect(props: {
  value: PaidPlan;
  onChange: (plan: PaidPlan) => void;
  disabled?: boolean;
  aiUsageBilling: boolean;
  pendingDowngrade: boolean;
}) {
  const options = () => planOptionsFor(props.aiUsageBilling);
  const selectedOption = () =>
    options().find((option) => option.value === props.value) ?? options()[0];

  return (
    <div class="flex items-center gap-2">
      <Select<PlanOption>
        options={options()}
        value={selectedOption()}
        onChange={(opt) => opt && props.onChange(opt.value)}
        optionValue="value"
        optionTextValue="label"
        gutter={4}
        placement="bottom-end"
        disabled={props.disabled}
        itemComponent={(itemProps: { item: CollectionNode<PlanOption> }) => (
          <Select.Item
            item={itemProps.item}
            class="flex items-center justify-between gap-3 px-2 py-1.5 text-sm rounded-xs hover:bg-hover outline-none data-highlighted:bg-hover"
          >
            <Select.ItemLabel class="flex flex-col">
              <span>{itemProps.item.rawValue.label}</span>
              <span class="text-xs text-ink-muted">
                {itemProps.item.rawValue.description}
              </span>
            </Select.ItemLabel>
            <Select.ItemIndicator>
              <CheckIcon class="size-3" />
            </Select.ItemIndicator>
          </Select.Item>
        )}
      >
        <Select.Trigger
          as={Button}
          class="rounded-xs px-1 py-0.5 text-xs -ml-1 data-expanded:bg-ink/10"
          disabled={props.disabled}
          aria-label="Seat plan"
        >
          <Select.Value<PlanOption>>
            {(state) => state.selectedOption().label}
          </Select.Value>
          <CaretDownIcon class="size-3 text-ink-muted shrink-0" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Content class="menu-surface z-action-menu min-w-40 p-1">
            <Select.Listbox />
          </Select.Content>
        </Select.Portal>
      </Select>
      <Show when={props.value === 'max' && props.pendingDowngrade}>
        <Button
          size="sm"
          variant="outline"
          disabled={props.disabled}
          onClick={() => props.onChange('max')}
        >
          Keep Max
        </Button>
      </Show>
    </div>
  );
}
