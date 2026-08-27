import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import sizes from '@sandbox-sizes';
import { Dropdown } from '@ui';
import { For } from 'solid-js';

/** Named compute tier for a managed coding-agent sandbox. */
export type SandboxSize = 'small' | 'default' | 'large';

const TIER_LABELS: Record<SandboxSize, string> = {
  small: 'Small',
  default: 'Default',
  large: 'Large',
};

const TIERS = (Object.keys(TIER_LABELS) as SandboxSize[]).map((id) => {
  const { cpu, memoryGib, diskGib } = sizes[id];
  return {
    id,
    label: TIER_LABELS[id],
    detail: `${cpu} vCPU · ${memoryGib} GiB · ${diskGib} GiB`,
  };
});

export interface SandboxSizeSelectorProps {
  size: SandboxSize;
  disabled?: boolean;
  onSelect: (size: SandboxSize) => void;
}

export function SandboxSizeSelector(props: SandboxSizeSelectorProps) {
  const selected = () =>
    TIERS.find((tier) => tier.id === props.size) ?? TIERS[1]!;

  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        class="rounded-lg gap-1.5 text-xs"
        disabled={props.disabled}
        label={selected().label}
      >
        {selected().label}
        <CaretDown />
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={TIERS}>
            {(tier) => (
              <Dropdown.Item
                class="gap-2"
                onSelect={() => props.onSelect(tier.id)}
              >
                <span class="flex min-w-0 flex-col">
                  <span class="text-xs">{tier.label}</span>
                  <span class="text-[11px] text-ink-extra-muted">
                    {tier.detail}
                  </span>
                </span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
