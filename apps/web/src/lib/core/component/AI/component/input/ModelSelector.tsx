import {
  DEFAULT_MODEL,
  MODEL_PRETTYNAME,
  MODEL_PROVIDER_ICON,
  Model,
} from '@core/component/AI/constant';
import type { TModel } from '@core/component/AI/types';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import LockIcon from '@phosphor-icons/core/regular/lock-simple.svg?component-solid';
import { cn, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** A model and whether the current user may select it. */
export type ModelOption = { id: TModel; available: boolean };

type ModelSelectorProps = {
  selectedModel?: TModel;
  /** Per-model availability. Defaults to all models available. */
  models?: ModelOption[];
  onSelect: (model: TModel) => void;
  /** Called when an unavailable model is clicked (e.g. to open the paywall). */
  onLocked?: (model: TModel) => void;
  /** Collapse the trigger to just the provider icon (narrow inputs). */
  compact?: boolean;
};

const ALL_AVAILABLE: ModelOption[] = (Object.values(Model) as TModel[]).map(
  (id) => ({ id, available: true })
);

export function ModelSelector(props: ModelSelectorProps) {
  const model = () => props.selectedModel ?? DEFAULT_MODEL;
  const options = () =>
    props.models && props.models.length > 0 ? props.models : ALL_AVAILABLE;

  const handleSelect = (option: ModelOption) => {
    if (option.available) {
      props.onSelect(option.id);
    } else {
      props.onLocked?.(option.id);
    }
  };

  return (
    <Dropdown placement="top-end">
      <Dropdown.Trigger
        variant="ghost"
        size={props.compact ? 'icon-sm' : 'sm'}
        class={cn('rounded-lg text-xs', !props.compact && 'gap-1.5')}
        label={props.compact ? MODEL_PRETTYNAME[model()] : undefined}
      >
        <Dynamic component={MODEL_PROVIDER_ICON[model()]} />
        <Show when={!props.compact}>
          {MODEL_PRETTYNAME[model()]}
          <CaretDown />
        </Show>
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={options()}>
            {(option) => (
              // Unavailable items stay clickable (not Kobalte-disabled) so the
              // click can open the paywall; they're just visually dimmed.
              <Dropdown.Item
                class={cn('gap-2', !option.available && 'opacity-50')}
                onSelect={() => handleSelect(option)}
              >
                <Dynamic
                  component={MODEL_PROVIDER_ICON[option.id]}
                  class="size-4 shrink-0"
                />
                <span class="flex-1 truncate text-xs">
                  {MODEL_PRETTYNAME[option.id]}
                </span>
                <Show when={!option.available}>
                  <LockIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
                </Show>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
