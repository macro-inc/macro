import Check from '@phosphor/check.svg';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';

type EffortOption = {
  value: string;
  name: string;
  description?: string | null;
};

export interface AgentEffortSelectorProps {
  current: string;
  changingTo?: string;
  options: readonly EffortOption[];
  disabled?: boolean;
  onSelect: (value: string) => void;
}

/** Compact selector for an ACP `thought_level` session config option. */
export function AgentEffortSelector(props: AgentEffortSelectorProps) {
  const shown = () => props.changingTo ?? props.current;
  const label = () =>
    props.options.find((option) => option.value === shown())?.name ?? shown();
  const disabled = () => props.disabled || props.changingTo !== undefined;

  return (
    <Dropdown placement="top-start">
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        aria-label="Reasoning effort"
        class="h-6 w-auto max-w-32 min-w-0 justify-start gap-1 rounded-full border-transparent bg-ink/5 px-2 text-left text-sm text-ink-subtle hover:bg-ink/10"
        disabled={disabled()}
      >
        <TextShimmer text={label()} active={props.changingTo !== undefined} />
        <CaretDown />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-44 max-w-[calc(100vw-1rem)] p-1.5">
        <Dropdown.Group>
          <Dropdown.GroupLabel>Reasoning effort</Dropdown.GroupLabel>
          <For each={props.options}>
            {(option) => (
              <Dropdown.Item
                class="h-7 gap-2"
                title={option.description ?? undefined}
                onSelect={() => {
                  if (option.value !== props.current)
                    props.onSelect(option.value);
                }}
              >
                <span class="flex-1 truncate">{option.name}</span>
                <Show when={option.value === shown()}>
                  <Check class="size-3.5" />
                </Show>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
