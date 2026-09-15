import type { AgentModelSelectorProps } from '@app/features/block-agent/ui/AgentModelSelector';
import {
  modelProvider,
  ProviderIcon,
} from '@core/component/AI/component/ProviderIcon';
import CaretDownIcon from '@phosphor/caret-down.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { MenuAnchor, MenuGroup, MenuOption } from './Menu';

export type ModelChoice = { id: string; name: string; provider: string };

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  openai: 'OpenAI',
  other: 'Other',
};

/** Shared model pill and menu for new chats and their running sessions. */
export function ModelSelector(props: {
  model?: string;
  selected?: string;
  label: JSX.Element;
  options: ModelChoice[];
  searchable?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onSelect: (id: string) => void;
  children?: (close: () => void) => JSX.Element;
}) {
  const [filter, setFilter] = createSignal('');
  const providers = () =>
    [...new Set(props.options.map((model) => model.provider))].toSorted();
  const filteredModels = (provider: string) => {
    const query = props.searchable ? filter().trim().toLowerCase() : '';
    return props.options.filter(
      (model) =>
        model.provider === provider &&
        (!query ||
          model.name.toLowerCase().includes(query) ||
          model.id.toLowerCase().includes(query))
    );
  };

  return (
    <Show when={props.options.length > 0}>
      <MenuAnchor
        menuLabel="Model"
        trigger={(menu) => (
          <button
            type="button"
            class="pill disabled:opacity-50"
            aria-label="Model"
            aria-haspopup="listbox"
            aria-expanded={menu.open()}
            aria-busy={props.pending || undefined}
            disabled={props.disabled || props.pending}
            title="Model"
            onClick={(event) => {
              event.stopPropagation();
              menu.toggle();
            }}
          >
            <span class="logo">
              <ProviderIcon
                model={props.model}
                class="size-4"
                animate={props.pending}
              />
            </span>
            <span class="lbl truncate">{props.label}</span>
            <CaretDownIcon class="ph caret" />
          </button>
        )}
      >
        {(close) => (
          <>
            <Show when={props.searchable}>
              <div class="filter">
                <MagnifyingGlassIcon class="ph" />
                <input
                  placeholder="Filter models"
                  aria-label="Filter models"
                  value={filter()}
                  onInput={(event) => setFilter(event.currentTarget.value)}
                />
              </div>
            </Show>
            {props.children?.(close)}
            <For each={providers()}>
              {(provider) => (
                <Show when={filteredModels(provider).length > 0}>
                  <MenuGroup>{PROVIDER_NAMES[provider] ?? provider}</MenuGroup>
                  <For each={filteredModels(provider)}>
                    {(model) => (
                      <MenuOption
                        checked={props.selected === model.id}
                        disabled={props.disabled || props.pending}
                        onSelect={() => {
                          props.onSelect(model.id);
                          close();
                        }}
                      >
                        <span class="logo">
                          <ProviderIcon model={model.id} class="size-4" />
                        </span>
                        <span class="nm">{model.name}</span>
                        <span class="id mono">{model.id}</span>
                      </MenuOption>
                    )}
                  </For>
                </Show>
              )}
            </For>
          </>
        )}
      </MenuAnchor>
    </Show>
  );
}

/** Use the session's advertised catalog and existing model-change action. */
export function SessionModelSelector(props: AgentModelSelectorProps) {
  const shown = () => props.changingTo ?? props.model ?? undefined;
  return (
    <ModelSelector
      model={shown()}
      selected={shown()}
      label={
        props.options.find((option) => option.id === shown())?.name ??
        shown() ??
        'Model'
      }
      options={props.options.map((option) => ({
        id: option.id,
        name: option.name,
        provider: modelProvider(option.id) ?? 'other',
      }))}
      disabled={props.disabled}
      pending={props.changingTo !== undefined}
      searchable={props.options.length > 8}
      onSelect={(id) => {
        if (id !== props.model) props.onSelect(id);
      }}
    />
  );
}
