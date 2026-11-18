import { t } from '@app/lib/i18n';
import type { ModelProviderGroup } from '@core/component/AI/component/input/modelCatalog';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import CaretDown from '@icon/system/regular/caret-down.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import CaretUp from '@icon/system/regular/caret-up.svg';
import Check from '@icon/system/regular/check.svg';
import Gauge from '@icon/system/regular/gauge.svg';
import Lightning from '@icon/system/regular/lightning.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Plus from '@icon/system/regular/plus.svg';
import { Key } from '@solid-primitives/keyed';
import { Dropdown } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { AgentIcon } from '../../components/AgentGlyph';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { agentPickerGroups } from '../../core/agent-picker-groups';
import {
  hasSelectorOptions,
  modelSelection,
  selectorOptions,
  speedChoices,
  speedTier,
  visibleProviderModels,
} from '../../core/model-selection';
import { MACRO_PERSONA_ID } from '../../core/roster';
import { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSpeedMarker } from '../shared/model-speed-marker';
import { UnifiedModelTrigger } from '../shared/model-trigger';
import { UnifiedModelTriggerContent } from '../shared/model-trigger-content';

export function DesktopModelSelector() {
  const state = useUnifiedModelSelector();
  const { open, query, setQuery, changeOpen, expanded, toggleProvider } =
    createModelSelectorNavigation(state.onOpenChange, {
      models: () => state.suggestedModels,
      model: () =>
        state.suggestedSelected === false ? undefined : state.model,
    });
  let search: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  const modelRows = new Map<string, HTMLDivElement>();
  const foldRows = new Map<string, HTMLDivElement>();
  let foldKeyboard = false;
  const toggle = (provider: ModelProviderGroup, keyboard: boolean) => {
    const wasExpanded = expanded(provider.label);
    toggleProvider(provider.label);
    if (keyboard)
      queueMicrotask(() => {
        const target = wasExpanded
          ? foldRows.get(provider.label)
          : modelRows.get(provider.options[2].id);
        target?.focus();
      });
  };
  const chooseModel = (id: string) => {
    (state.onSuggestedModel ?? state.onModel)(id);
    changeOpen(false);
  };
  const choices = () => speedChoices(state.speeds ?? []);
  // Capability updates must not replace group objects and remount visible model rows.
  const catalog = createMemo(() => state.suggestedModels);
  const agents = createMemo(() => state.agents);
  const filtered = createMemo(() =>
    modelSelection(catalog(), agents() ?? [], query())
  );
  const groups = () => agentPickerGroups(filtered().agents);
  const modelGroups = createMemo(() =>
    [
      {
        label: t('agentControls.suggested'),
        options: filtered().suggested,
        foldable: false,
      },
      ...filtered().providers.map((provider) => ({
        ...provider,
        foldable: provider.options.length > 3,
      })),
    ].filter((group) => group.options.length > 0)
  );
  const options = () =>
    selectorOptions({
      modelCount: state.models.length,
      customAgent: state.agent?.id !== MACRO_PERSONA_ID,
      effortCount: state.effort?.options.length ?? 0,
      speedValues: state.speeds ?? [],
    });
  const showOptions = () => !query().trim() && hasSelectorOptions(options());
  return (
    <Dropdown open={open()} onOpenChange={changeOpen} placement="top-end">
      <UnifiedModelTrigger>
        <Dropdown.Trigger
          variant="ghost"
          disabled={state.disabled}
          aria-label={t('agentControls.modelSelector')}
          class="min-w-0 max-w-[min(18rem,100%)]"
        >
          <UnifiedModelTriggerContent />
        </Dropdown.Trigger>
      </UnifiedModelTrigger>
      <Dropdown.Content
        onCloseAutoFocus={state.onCloseAutoFocus}
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault();
          // Kobalte schedules its list autofocus on mount; focus search after that work.
          setTimeout(
            () =>
              requestAnimationFrame(() => {
                if (list) list.scrollTop = 0;
                if (search?.isConnected) search.focus();
              }),
            0
          );
        }}
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (
            event.target === search ||
            event.defaultPrevented ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return;
          if (event.key.length === 1 && event.key !== ' ') {
            event.preventDefault();
            search?.focus();
            setQuery(query() + event.key);
          }
        }}
        // A reactive focus flag on menu items makes Kobalte re-focus the row after search.focus().
        class="w-[300px] max-w-[calc(100vw-1rem)] overflow-hidden [&:has(input:focus)_[data-search-first]]:bg-ink/5"
      >
        <div class="flex max-h-[min(28rem,var(--kb-popper-content-available-height))] flex-col">
          <div class="flex h-10 shrink-0 items-center gap-2 px-3.5">
            <Search class="size-4 text-ink-extra-muted" />
            <input
              ref={search}
              aria-label={
                state.agents?.length
                  ? t('agentControls.searchAgentsModels')
                  : t('agentControls.searchModels')
              }
              placeholder={
                state.agents?.length
                  ? t('agentControls.searchAgentsModels')
                  : t('agentControls.searchModels')
              }
              value={query()}
              onFocusIn={(event) => event.stopPropagation()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') event.stopPropagation();
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  list
                    ?.querySelector<HTMLElement>(
                      '[role="menuitemradio"]:not([data-disabled]), [role="menuitem"]:not([data-disabled])'
                    )
                    ?.focus();
                }
              }}
              class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-extra-muted"
            />
          </div>
          <div ref={list} class="min-h-0 overflow-y-auto overscroll-contain">
            <Key each={modelGroups()} by="label">
              {(group) => (
                <Dropdown.Group>
                  <Dropdown.GroupLabel>{group().label}</Dropdown.GroupLabel>
                  <Dropdown.RadioGroup
                    value={
                      state.suggestedSelected !== false
                        ? state.model
                        : undefined
                    }
                  >
                    <Key
                      by="id"
                      each={
                        group().foldable
                          ? visibleProviderModels(
                              group(),
                              expanded(group().label),
                              query()
                            )
                          : group().options
                      }
                    >
                      {(option) => (
                        <Dropdown.RadioItem
                          ref={(element: HTMLDivElement) =>
                            modelRows.set(option().id, element)
                          }
                          value={option().id}
                          data-search-first={
                            query().trim() &&
                            modelGroups()[0]?.options[0]?.id === option().id
                              ? ''
                              : undefined
                          }
                          closeOnSelect
                          disabled={state.disabled || state.suggestedDisabled}
                          onSelect={() => chooseModel(option().id)}
                        >
                          <ModelIcon model={option().id} />
                          <Dropdown.ItemLabel class="min-w-0 flex-1 truncate">
                            {option().label}
                          </Dropdown.ItemLabel>
                          <ModelSpeedMarker model={option().id} />
                          <Dropdown.ItemIndicator>
                            <Check class="size-3.5 text-accent" />
                          </Dropdown.ItemIndicator>
                        </Dropdown.RadioItem>
                      )}
                    </Key>
                  </Dropdown.RadioGroup>
                  <Show when={group().foldable && !query().trim()}>
                    <Dropdown.Item
                      ref={(element: HTMLDivElement) =>
                        foldRows.set(group().label, element)
                      }
                      closeOnSelect={false}
                      onPointerDown={() => {
                        foldKeyboard = false;
                      }}
                      onSelect={() => {
                        const keyboard = foldKeyboard;
                        foldKeyboard = false;
                        toggle(group(), keyboard);
                      }}
                      onKeyDown={(event: KeyboardEvent) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          foldKeyboard = true;
                        }
                      }}
                    >
                      <span class="flex size-4 shrink-0 items-center justify-center text-ink-extra-muted">
                        <Show
                          when={expanded(group().label)}
                          fallback={<CaretDown class="size-3.5" />}
                        >
                          <CaretUp class="size-3.5" />
                        </Show>
                      </span>
                      <Dropdown.ItemLabel class="text-ink-muted">
                        {expanded(group().label)
                          ? t('agentControls.showFewerModels')
                          : t('agentControls.showAllModels', {
                              count: group().options.length,
                            })}
                      </Dropdown.ItemLabel>
                    </Dropdown.Item>
                  </Show>
                </Dropdown.Group>
              )}
            </Key>
            <Show
              when={
                modelGroups().length === 0 &&
                filtered().agents.length === 0 &&
                !state.loading
              }
            >
              <p role="status" class="p-1.5 px-2 text-sm text-ink-extra-muted">
                {t('agentControls.noMatches')}
              </p>
            </Show>
            <For each={groups()}>
              {(group) => (
                <Dropdown.Group>
                  <Dropdown.GroupLabel>{group.label}</Dropdown.GroupLabel>
                  <Dropdown.RadioGroup value={state.agent?.id}>
                    <For each={group.agents}>
                      {(agent) => (
                        <Show
                          when={!agent.unavailableReason}
                          fallback={
                            <Dropdown.Item
                              closeOnSelect
                              disabled={!agent.connectLabel}
                              onSelect={() => {
                                changeOpen(false);
                                state.onConnect?.(agent);
                              }}
                            >
                              <span class="flex size-4 shrink-0 items-center justify-center rounded-md bg-ink/5">
                                <AgentIcon agent={agent} class="size-4" />
                              </span>
                              <Dropdown.ItemLabel class="min-w-0 flex-1 truncate">
                                {agent.name}
                              </Dropdown.ItemLabel>
                              <Show when={agent.share !== 'system'}>
                                <span class="truncate text-xs text-ink-extra-muted">
                                  {agent.runtime.label}
                                </span>
                              </Show>
                            </Dropdown.Item>
                          }
                        >
                          <Dropdown.RadioItem
                            value={agent.id}
                            closeOnSelect={false}
                            onSelect={() => state.onAgent?.(agent)}
                          >
                            <span class="flex size-4 shrink-0 items-center justify-center rounded-md bg-ink/5">
                              <AgentIcon agent={agent} class="size-4" />
                            </span>
                            <Dropdown.ItemLabel class="min-w-0 flex-1 truncate">
                              {agent.name}
                            </Dropdown.ItemLabel>
                            <Show when={agent.share !== 'system'}>
                              <span class="truncate text-xs text-ink-extra-muted">
                                {agent.runtime.label}
                              </span>
                            </Show>
                            <Dropdown.ItemIndicator>
                              <Check class="size-3.5 text-accent" />
                            </Dropdown.ItemIndicator>
                          </Dropdown.RadioItem>
                        </Show>
                      )}
                    </For>
                  </Dropdown.RadioGroup>
                </Dropdown.Group>
              )}
            </For>
            <Show when={state.loading || (state.onCreate && !query().trim())}>
              <Dropdown.Group>
                <Show when={state.loading}>
                  <p role="status" class="text-xs text-ink-muted">
                    {t('agentControls.loadingAgents')}
                  </p>
                </Show>
                <Show when={state.onCreate && !query().trim()}>
                  <Dropdown.Item
                    onSelect={() => {
                      changeOpen(false);
                      state.onCreate?.();
                    }}
                  >
                    <Plus class="size-4" />
                    <Dropdown.ItemLabel>
                      {t('agentControls.createAgent')}
                    </Dropdown.ItemLabel>
                  </Dropdown.Item>
                </Show>
              </Dropdown.Group>
            </Show>
          </div>
          <Show when={showOptions()}>
            <div class="shrink-0 border-t border-edge-muted">
              <Dropdown.Group>
                <Show when={options().model}>
                  <Dropdown.Sub>
                    <Dropdown.SubTrigger>
                      <ModelIcon model={state.model} />
                      <span class="flex-1">{t('agentControls.model')}</span>
                      <span class="max-w-24 truncate text-ink-extra-muted">
                        {
                          state.models.find(
                            (option) => option.id === state.model
                          )?.label
                        }
                      </span>
                      <CaretRight class="size-3.5" />
                    </Dropdown.SubTrigger>
                    <Dropdown.SubContent class="w-48 max-h-80 overflow-y-auto">
                      <Dropdown.Group>
                        <Dropdown.RadioGroup value={state.model}>
                          <For each={state.models}>
                            {(option) => (
                              <Dropdown.RadioItem
                                value={option.id}
                                closeOnSelect
                                onSelect={() => {
                                  state.onModel(option.id);
                                  changeOpen(false);
                                }}
                              >
                                <Dropdown.ItemLabel class="flex-1">
                                  {option.label}
                                </Dropdown.ItemLabel>
                                <Dropdown.ItemIndicator>
                                  <Check class="size-3.5 text-accent" />
                                </Dropdown.ItemIndicator>
                              </Dropdown.RadioItem>
                            )}
                          </For>
                        </Dropdown.RadioGroup>
                      </Dropdown.Group>
                    </Dropdown.SubContent>
                  </Dropdown.Sub>
                </Show>
                <Show when={options().effort}>
                  <Dropdown.Sub>
                    <Dropdown.SubTrigger disabled={state.effortDisabled}>
                      <Gauge class="size-4" />
                      <span class="flex-1">
                        {t('agentControls.reasoningEffort')}
                      </span>
                      <span class="text-ink-extra-muted">
                        {
                          state.effort?.options.find(
                            (choice) =>
                              choice.value ===
                              (state.effortValue ?? state.effort?.currentValue)
                          )?.name
                        }
                      </span>
                      <CaretRight class="size-3.5" />
                    </Dropdown.SubTrigger>
                    <Dropdown.SubContent class="w-48">
                      <Dropdown.Group>
                        <Dropdown.RadioGroup
                          value={
                            state.effortValue ?? state.effort?.currentValue
                          }
                        >
                          <For each={state.effort?.options}>
                            {(choice) => (
                              <Dropdown.RadioItem
                                value={choice.value}
                                closeOnSelect
                                disabled={state.effortDisabled}
                                onSelect={() => {
                                  if (state.effort && !state.effortDisabled)
                                    state.onEffort({
                                      configId: state.effort.id,
                                      value: choice.value,
                                      name: choice.name,
                                    });
                                  changeOpen(false);
                                }}
                              >
                                <Dropdown.ItemLabel class="flex-1">
                                  {choice.name}
                                </Dropdown.ItemLabel>
                                <Dropdown.ItemIndicator>
                                  <Check class="size-3.5 text-accent" />
                                </Dropdown.ItemIndicator>
                              </Dropdown.RadioItem>
                            )}
                          </For>
                        </Dropdown.RadioGroup>
                      </Dropdown.Group>
                    </Dropdown.SubContent>
                  </Dropdown.Sub>
                </Show>
                <Show when={options().speed}>
                  <Dropdown.Sub>
                    <Dropdown.SubTrigger>
                      <Lightning class="size-4" />
                      <span class="flex-1">{t('agentControls.speed')}</span>
                      <span class="text-ink-extra-muted">
                        {t(`agentControls.tier${speedTier(state.speedValue)}`)}
                      </span>
                      <CaretRight class="size-3.5" />
                    </Dropdown.SubTrigger>
                    <Dropdown.SubContent class="w-48">
                      <Dropdown.Group>
                        <Dropdown.RadioGroup value={state.speedValue}>
                          <For each={choices()}>
                            {(choice) => (
                              <Dropdown.RadioItem
                                value={choice.value}
                                closeOnSelect
                                onSelect={() => {
                                  state.onSpeed(choice.value);
                                  changeOpen(false);
                                }}
                              >
                                <Dropdown.ItemLabel class="flex-1">
                                  {t(`agentControls.tier${choice.tier}`)}
                                </Dropdown.ItemLabel>
                                <Show when={choice.tier !== 'standard'}>
                                  <span class="text-xs text-ink-extra-muted">
                                    {choice.tier === 'fast'
                                      ? t('agentControls.usageFast')
                                      : t('agentControls.usageUltrafast')}
                                  </span>
                                </Show>
                                <Dropdown.ItemIndicator>
                                  <Check class="size-3.5 text-accent" />
                                </Dropdown.ItemIndicator>
                              </Dropdown.RadioItem>
                            )}
                          </For>
                        </Dropdown.RadioGroup>
                      </Dropdown.Group>
                    </Dropdown.SubContent>
                  </Dropdown.Sub>
                </Show>
              </Dropdown.Group>
            </div>
          </Show>
        </div>
      </Dropdown.Content>
    </Dropdown>
  );
}
