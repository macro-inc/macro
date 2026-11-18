import { t } from '@app/lib/i18n';
import { ModelCatalogMenu } from '@core/component/AI/component/input/ModelCatalogPicker';
import { buildModelCatalog } from '@core/component/AI/component/input/modelCatalog';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Check from '@icon/system/regular/check.svg';
import Gauge from '@icon/system/regular/gauge.svg';
import Lightning from '@icon/system/regular/lightning.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Plus from '@icon/system/regular/plus.svg';
import Squares from '@icon/system/regular/squares-four.svg';
import { Dropdown } from '@ui';
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

export function DesktopModelSelector() {
  const state = useUnifiedModelSelector();
  const { open, query, setQuery, changeOpen } = createModelSelectorNavigation(
    state.onOpenChange
  );
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
          class="h-8 min-w-0 max-w-[min(18rem,100%)] gap-1.5 rounded-full px-2 text-base font-normal hover:bg-hover"
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
          <div class="min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
            <Show when={filtered().suggested.length}>
              <Dropdown.Group class="py-0">
                <Dropdown.GroupLabel>
                  {t('agentControls.suggested')}
                </Dropdown.GroupLabel>
                <For each={filtered().suggested}>
                  {(option) => (
                    <Dropdown.Item
                      closeOnSelect
                      disabled={state.disabled || state.suggestedDisabled}
                      class="min-h-8 gap-2 rounded-lg px-2"
                      onSelect={() => chooseModel(option.id)}
                    >
                      <ModelIcon model={option.id} />
                      <span class="min-w-0 flex-1 truncate">
                        {option.label}
                      </span>
                      <ModelSpeedMarker model={option.id} />
                      <Show
                        when={
                          state.suggestedSelected !== false &&
                          option.id === state.model
                        }
                      >
                        <Check class="size-3.5 text-accent" />
                      </Show>
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Group>
            </Show>
            <Show
              when={
                !query().trim() &&
                buildModelCatalog(state.suggestedModels, true).providers
                  .length > 0
              }
            >
              <Dropdown.Sub>
                <Dropdown.SubTrigger class="h-8 gap-2">
                  <Squares class="size-4" />
                  <span class="flex-1">{t('agentControls.allModels')}</span>
                  <CaretRight class="size-3.5" />
                </Dropdown.SubTrigger>
                <Dropdown.SubContent
                  aria-label={t('agentControls.allModels')}
                  class="w-72 max-h-[min(28rem,var(--kb-popper-content-available-height))] overflow-y-auto"
                  onPointerDown={(event: PointerEvent) =>
                    event.stopPropagation()
                  }
                  onMouseDown={(event: MouseEvent) => event.stopPropagation()}
                >
                  <ModelCatalogMenu
                    disabled={state.disabled || state.suggestedDisabled}
                    fullCatalog
                    autoFocusSearch
                    value={state.model ?? null}
                    options={state.suggestedModels}
                    onSelect={chooseModel}
                  />
                </Dropdown.SubContent>
              </Dropdown.Sub>
            </Show>
            <For each={groups()}>
              {(group) => (
                <Dropdown.Group class="py-0">
                  <Dropdown.GroupLabel>{group.label}</Dropdown.GroupLabel>
                  <For each={group.agents}>
                    {(agent) => (
                      <Dropdown.Item
                        closeOnSelect={Boolean(agent.unavailableReason)}
                        disabled={Boolean(
                          agent.unavailableReason && !agent.connectLabel
                        )}
                        class="min-h-8 gap-2 rounded-lg px-2"
                        onSelect={() => {
                          if (agent.unavailableReason) {
                            changeOpen(false);
                            state.onConnect?.(agent);
                          } else state.onAgent?.(agent);
                        }}
                      >
                        <span class="flex size-4 shrink-0 items-center justify-center rounded-md bg-ink/5">
                          <AgentIcon agent={agent} class="size-4" />
                        </span>
                        <span class="min-w-0 flex-1 truncate">
                          {agent.name}
                        </span>
                        <Show when={agent.share !== 'system'}>
                          <span class="truncate text-xs text-ink-extra-muted">
                            {agent.runtime.label}
                          </span>
                        </Show>
                        <Show when={agent.id === state.agent?.id}>
                          <Check class="size-3.5 text-accent" />
                        </Show>
                      </Dropdown.Item>
                    )}
                  </For>
                </Dropdown.Group>
              )}
            </For>
            <Show when={state.loading}>
              <p role="status" class="px-2 py-1 text-xs text-ink-muted">
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
                {t('agentControls.createAgent')}
              </Dropdown.Item>
            </Show>
          </div>
          <Show when={showOptions()}>
            <div class="shrink-0 border-t border-edge-muted p-1.5">
              <Show when={options().model}>
                <Dropdown.Sub gutter={2} shift={-7}>
                  <Dropdown.SubTrigger class="h-8 gap-2">
                    <ModelIcon model={state.model} />
                    <span class="flex-1">{t('agentControls.model')}</span>
                    <span class="max-w-24 truncate text-ink-extra-muted">
                      {
                        state.models.find((option) => option.id === state.model)
                          ?.label
                      }
                    </span>
                    <CaretRight class="size-3.5" />
                  </Dropdown.SubTrigger>
                  <Dropdown.SubContent class="w-48 max-h-80 overflow-y-auto">
                    <For each={state.models}>
                      {(option) => (
                        <Dropdown.Item
                          closeOnSelect
                          class="h-8"
                          onSelect={() => {
                            state.onModel(option.id);
                            changeOpen(false);
                          }}
                        >
                          {option.label}
                          <Show when={state.model === option.id}>
                            <Check class="ml-auto size-3.5 text-accent" />
                          </Show>
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.SubContent>
                </Dropdown.Sub>
              </Show>
              <Show when={options().effort}>
                <Dropdown.Sub gutter={2} shift={-7}>
                  <Dropdown.SubTrigger
                    disabled={state.effortDisabled}
                    class="h-8 gap-2"
                  >
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
                  <Dropdown.SubContent class="w-48 p-1.5">
                    <For each={state.effort?.options}>
                      {(choice) => (
                        <Dropdown.Item
                          closeOnSelect
                          class="h-8"
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
                          {choice.name}
                          <Show
                            when={
                              choice.value ===
                              (state.effortValue ?? state.effort?.currentValue)
                            }
                          >
                            <Check class="ml-auto size-3.5 text-accent" />
                          </Show>
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.SubContent>
                </Dropdown.Sub>
              </Show>
              <Show when={options().speed}>
                <Dropdown.Sub gutter={2} shift={-7}>
                  <Dropdown.SubTrigger class="h-8 gap-2">
                    <Lightning class="size-4" />
                    <span class="flex-1">{t('agentControls.speed')}</span>
                    <span class="text-ink-extra-muted">
                      {t(`agentControls.tier${speedTier(state.speedValue)}`)}
                    </span>
                    <CaretRight class="size-3.5" />
                  </Dropdown.SubTrigger>
                  <Dropdown.SubContent class="w-48 p-1.5">
                    <For each={choices()}>
                      {(choice) => (
                        <Dropdown.Item
                          closeOnSelect
                          class="h-8"
                          onSelect={() => {
                            state.onSpeed(choice.value);
                            changeOpen(false);
                          }}
                        >
                          {t(`agentControls.tier${choice.tier}`)}
                          <Show when={choice.tier !== 'standard'}>
                            <span class="ml-2 text-xs text-ink-extra-muted">
                              {choice.tier === 'fast'
                                ? t('agentControls.usageFast')
                                : t('agentControls.usageUltrafast')}
                            </span>
                          </Show>
                          <Show when={choice.value === state.speedValue}>
                            <Check class="ml-auto size-3.5 text-accent" />
                          </Show>
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.SubContent>
                </Dropdown.Sub>
              </Show>
            </div>
          </Show>
        </div>
      </Dropdown.Content>
    </Dropdown>
  );
}
