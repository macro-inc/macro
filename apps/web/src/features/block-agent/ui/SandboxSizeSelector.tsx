import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import { Dropdown } from '@ui';
import { For } from 'solid-js';

/** Named compute tier for a managed coding-agent sandbox. */
export type SandboxSize = 'small' | 'default' | 'large';

const TIERS: {
  id: SandboxSize;
  label: string;
  detail: string;
}[] = [
  { id: 'small', label: 'Small', detail: '2 vCPU · 4 GiB · 96 GiB' },
  { id: 'default', label: 'Default', detail: '8 vCPU · 16 GiB · 96 GiB' },
  { id: 'large', label: 'Large', detail: '16 vCPU · 32 GiB · 96 GiB' },
];

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
