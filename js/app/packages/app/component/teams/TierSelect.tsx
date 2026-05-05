import { Select } from '@kobalte/core/select';
import type { CollectionNode } from '@kobalte/core';
import CaretDownIcon from '@icon/regular/caret-down.svg';
import CheckIcon from '@icon/regular/check.svg';
import { PLAN_FEATURES, type PaidPlanTier } from '@app/component/paywall/plans';
import type { ValidComponent } from 'solid-js';

type TierOption = { value: PaidPlanTier; label: string; description: string };

const getTierDescription = (tier: PaidPlanTier): string => {
  const aiAgent =
    PLAN_FEATURES.find((f) => f.label === 'AI Agent')?.values[tier] ?? '';
  const aiCalls =
    PLAN_FEATURES.find((f) => f.label === 'AI tool calls')?.values[tier] ?? '';
  const storage =
    PLAN_FEATURES.find((f) => f.label === 'Storage')?.values[tier] ?? '';
  return `${aiAgent} · ${aiCalls} calls · ${storage}`;
};

const tierOptions: TierOption[] = [
  {
    value: 'haiku',
    label: 'Level 1',
    description: getTierDescription('haiku'),
  },
  {
    value: 'sonnet',
    label: 'Level 2',
    description: getTierDescription('sonnet'),
  },
  { value: 'opus', label: 'Level 3', description: getTierDescription('opus') },
];

export function TierSelect(props: {
  value: PaidPlanTier;
  onChange: (tier: PaidPlanTier) => void;
  triggerClass?: string;
  triggerAs?: ValidComponent;
  disabled?: boolean;
}) {
  const selectedOption = () =>
    tierOptions.find((o) => o.value === props.value) ?? tierOptions[0];

  return (
    <Select<TierOption>
      options={tierOptions}
      value={selectedOption()}
      onChange={(opt) => opt && props.onChange(opt.value)}
      optionValue="value"
      optionTextValue="label"
      gutter={4}
      placement="bottom-end"
      disabled={props.disabled}
      itemComponent={(itemProps: { item: CollectionNode<TierOption> }) => (
        <Select.Item
          item={itemProps.item}
          class="flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded-xs hover:bg-hover/50 outline-none data-highlighted:bg-hover bracket-never"
        >
          <div class="flex flex-col">
            <Select.ItemLabel>{itemProps.item.rawValue.label}</Select.ItemLabel>
            <span class="text-xs text-ink/50">
              {itemProps.item.rawValue.description}
            </span>
          </div>
          <Select.ItemIndicator>
            <CheckIcon class="w-3 h-3" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger
        as={props.triggerAs}
        tabIndex={0}
        class={
          props.triggerClass ??
          'rounded-xs px-2 py-1 text-xs data-[expanded]:bg-ink/10'
        }
        disabled={props.disabled}
      >
        <Select.Value<TierOption>>
          {(state) => state.selectedOption().label}
        </Select.Value>
        <CaretDownIcon class="w-3 h-3 text-ink-muted shrink-0" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content class="flex flex-col justify-start items-start bg-menu shadow-lg ring-1 ring-edge-muted rounded-sm p-1 cursor-default select-none max-w-full max-h-[calc(100dvh-10rem)] overflow-y-auto z-modal">
          <Select.Listbox />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}
