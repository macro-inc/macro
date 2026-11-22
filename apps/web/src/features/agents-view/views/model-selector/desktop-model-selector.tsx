import { t } from '@app/lib/i18n';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Check from '@icon/system/regular/check.svg';
import Gauge from '@icon/system/regular/gauge.svg';
import Lightning from '@icon/system/regular/lightning.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Plus from '@icon/system/regular/plus.svg';
import Squares from '@icon/system/regular/squares-four.svg';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { AgentIcon } from '../../components/AgentGlyph';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { agentPickerGroups } from '../../core/agent-picker-groups';
import {
  hasSelectorOptions,
  modelSelection,
  selectorOptions,
  speedChoices,
  speedTier,
} from '../../core/model-selection';
import { MACRO_PERSONA_ID } from '../../core/roster';
import { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSpeedMarker } from '../shared/model-speed-marker';
import { UnifiedModelTrigger } from '../shared/model-trigger';
import { UnifiedModelTriggerContent } from '../shared/model-trigger-content';
import { AllModelsMenu } from './all-models-menu';

export function DesktopModelSelector(props: {
  /** Show All models in place of the menu instead of as a flyout beside it. */
  catalogInPlace?: boolean;
}) {
  const state = useUnifiedModelSelector();
  const { open, query, setQuery, changeOpen, page, setPage, back } =
    createModelSelectorNavigation(state.onOpenChange);
  let search: HTMLInputElement | undefined;
  const chooseModel = (id: string) => {
    (state.onSuggestedModel ?? state.onModel)(id);
    changeOpen(false);
  };
  const choices = () => speedChoices(state.speeds ?? []);
  const filtered = () =>
    modelSelection(state.suggestedModels, state.agents ?? [], query());
  const groups = () => agentPickerGroups(filtered().agents);
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
          setTimeout(() => search?.focus(), 0);
        }}
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
        class="w-[300px] max-w-[calc(100vw-1rem)] overflow-hidden"
      >
        <Show
          when={page() === 'all'}
          fallback={
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
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') event.stopPropagation();
                  }}
                  class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-extra-muted"
                />
              </div>
              <div class="min-h-0 overflow-y-auto overscroll-contain">
                <Show when={filtered().suggested.length}>
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>
                      {t('agentControls.suggested')}
                    </Dropdown.GroupLabel>
                    <Dropdown.RadioGroup
                      value={
                        state.suggestedSelected !== false
                          ? state.model
                          : undefined
                      }
                    >
                      <For each={filtered().suggested}>
                        {(option) => (
                          <Dropdown.RadioItem
                            value={option.id}
                            closeOnSelect
                            disabled={state.disabled || state.suggestedDisabled}
                            onSelect={() => chooseModel(option.id)}
                          >
                            <ModelIcon model={option.id} />
                            <Dropdown.ItemLabel class="min-w-0 flex-1 truncate">
                              {option.label}
                            </Dropdown.ItemLabel>
                            <ModelSpeedMarker model={option.id} />
                            <Dropdown.ItemIndicator>
                              <Check class="size-3.5 text-accent" />
                            </Dropdown.ItemIndicator>
                          </Dropdown.RadioItem>
                        )}
                      </For>
                    </Dropdown.RadioGroup>
                  </Dropdown.Group>
                </Show>
                <Show when={!query().trim() && filtered().allModels.length > 0}>
                  <Dropdown.Group>
                    <Show
                      when={!props.catalogInPlace}
                      fallback={
                        <Dropdown.Item
                          closeOnSelect={false}
                          onSelect={() => setPage('all')}
                        >
                          <Squares class="size-4" />
                          <span class="flex-1">
                            {t('agentControls.allModels')}
                          </span>
                          <CaretRight class="size-3.5" />
                        </Dropdown.Item>
                      }
                    >
                      <Dropdown.Sub overlap>
                        <Dropdown.SubTrigger>
                          <Squares class="size-4" />
                          <span class="flex-1">
                            {t('agentControls.allModels')}
                          </span>
                          <CaretRight class="size-3.5" />
                        </Dropdown.SubTrigger>
                        <Dropdown.SubContent
                          aria-label={t('agentControls.allModels')}
                          // A fixed height: filtering never moves the search field.
                          class="flex w-72 h-[min(28rem,var(--kb-popper-content-available-height))] flex-col overflow-hidden"
                          onPointerDown={(event: PointerEvent) =>
                            event.stopPropagation()
                          }
                          onMouseDown={(event: MouseEvent) =>
                            event.stopPropagation()
                          }
                        >
                          <AllModelsMenu
                            disabled={state.disabled || state.suggestedDisabled}
                            model={state.model}
                            options={state.suggestedModels}
                            onSelect={chooseModel}
                          />
                        </Dropdown.SubContent>
                      </Dropdown.Sub>
                    </Show>
                  </Dropdown.Group>
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
                <Show when={state.loading || state.onCreate}>
                  <Dropdown.Group>
                    <Show when={state.loading}>
                      <p role="status" class="text-xs text-ink-muted">
                        {t('agentControls.loadingAgents')}
                      </p>
                    </Show>
                    <Show when={state.onCreate}>
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
                <div class="shrink-0">
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
                                  (state.effortValue ??
                                    state.effort?.currentValue)
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
                            {t(
                              `agentControls.tier${speedTier(state.speedValue)}`
                            )}
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
          }
        >
          <div class="flex max-h-[min(28rem,var(--kb-popper-content-available-height))] flex-col">
            <div class="flex h-10 shrink-0 items-center gap-1 px-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('agentControls.back')}
                onClick={back}
              >
                <ArrowLeft class="size-4" />
              </Button>
              <span class="text-sm font-medium">
                {t('agentControls.allModels')}
              </span>
            </div>
            <AllModelsMenu
              disabled={state.disabled || state.suggestedDisabled}
              model={state.model}
              options={state.suggestedModels}
              onSelect={chooseModel}
            />
          </div>
        </Show>
      </Dropdown.Content>
    </Dropdown>
  );
}
