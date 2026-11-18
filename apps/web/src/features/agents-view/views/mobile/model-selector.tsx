import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import CaretUp from '@icon/system/regular/caret-up.svg';
import Check from '@icon/system/regular/check.svg';
import Gauge from '@icon/system/regular/gauge.svg';
import Lightning from '@icon/system/regular/lightning.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Plus from '@icon/system/regular/plus.svg';
import { Key } from '@solid-primitives/keyed';
import { Button } from '@ui';
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
import { UnifiedModelTriggerContent } from '../shared/model-trigger-content';

export function MobileModelSelector() {
  const state = useUnifiedModelSelector();
  const {
    open,
    query,
    page,
    setQuery,
    setPage,
    changeOpen: setDrawerOpen,
    back,
    expanded,
    toggleProvider,
  } = createModelSelectorNavigation(state.onOpenChange, {
    models: () => state.suggestedModels,
    model: () => (state.suggestedSelected === false ? undefined : state.model),
  });
  let searchInput: HTMLInputElement | undefined;
  const changeOpen = (next: boolean) => {
    setDrawerOpen(next);
    if (next) setTimeout(() => searchInput?.focus(), 0);
  };
  // Keep row identity stable when a speed marker's capability request settles.
  const catalog = createMemo(() => state.suggestedModels);
  const agentModels = createMemo(() => state.models);
  const agents = createMemo(() => state.agents);
  const selected = createMemo(() =>
    modelSelection(catalog(), agents() ?? [], query())
  );
  const modelGroups = createMemo(() => {
    if (page() === 'model')
      return [
        {
          label: t('agentControls.model'),
          options: agentModels(),
          foldable: false,
        },
      ];
    return [
      {
        label: t('agentControls.suggested'),
        options: selected().suggested,
        foldable: false,
      },
      ...selected().providers.map((provider) => ({
        ...provider,
        foldable: provider.options.length > 3,
      })),
    ].filter((group) => group.options.length > 0);
  });
  const speeds = () => speedChoices(state.speeds ?? []);
  const chooseModel = (id: string) => {
    (page() === 'model'
      ? state.onModel
      : (state.onSuggestedModel ?? state.onModel))(id);
    changeOpen(false);
  };
  const options = () =>
    selectorOptions({
      modelCount: state.models.length,
      customAgent: state.agent?.id !== MACRO_PERSONA_ID,
      effortCount: state.effort?.options.length ?? 0,
      speedValues: state.speeds ?? [],
    });
  return (
    <MobileDrawer
      side="bottom"
      open={open()}
      onOpenChange={changeOpen}
      restoreFocus={Boolean(state.onCloseAutoFocus)}
      onFinalFocus={state.onCloseAutoFocus}
    >
      <MobileDrawer.Trigger
        as={Button}
        variant="ghost"
        size="sm"
        disabled={state.disabled}
        aria-label={t('agentControls.modelSelector')}
        class="min-w-0 max-w-full"
        onPointerDown={(event: PointerEvent) => event.preventDefault()}
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
      >
        <UnifiedModelTriggerContent mobile />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={t('agentControls.modelSelector')}>
          <MobileDrawer.Handle />
          <Show when={page() !== 'list'}>
            <div class="relative flex h-12 items-center px-3">
              <Button
                variant="ghost"
                size="icon-md"
                aria-label={t('agentControls.back')}
                onClick={back}
              >
                <ArrowLeft class="size-5" />
              </Button>
              <h2 class="absolute inset-x-14 text-center font-semibold pointer-events-none">
                {page() === 'speed'
                  ? t('agentControls.speed')
                  : page() === 'effort'
                    ? t('agentControls.reasoningEffort')
                    : t('agentControls.model')}
              </h2>
            </div>
          </Show>
          <Show when={page() === 'list'}>
            <div class="mx-3 mb-3 flex h-11 shrink-0 items-center gap-2.5 rounded-full bg-ink/3 px-3.5">
              <Search class="size-[18px] text-ink-subtle" />
              <input
                ref={searchInput}
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
                class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-subtle"
              />
            </div>
          </Show>
          <MobileDrawer.ScrollBody class="gap-4">
            <Show when={page() === 'list' || page() === 'model'}>
              <Key each={modelGroups()} by="label">
                {(group) => (
                  <div>
                    <MobileDrawer.Label>{group().label}</MobileDrawer.Label>
                    <MobileDrawer.Section>
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
                          <MobileDrawer.Item
                            disabled={
                              state.disabled ||
                              (page() !== 'model' && state.suggestedDisabled)
                            }
                            onClick={() => chooseModel(option().id)}
                          >
                            <span class="flex size-4.5 shrink-0 items-center justify-center">
                              <ModelIcon model={option().id} />
                            </span>
                            <span class="min-w-0 flex-1 truncate">
                              {option().label}
                            </span>
                            <ModelSpeedMarker model={option().id} />
                            <Show
                              when={
                                (page() === 'model' ||
                                  state.suggestedSelected !== false) &&
                                state.model === option().id
                              }
                            >
                              <Check class="size-4.5 text-accent" />
                            </Show>
                          </MobileDrawer.Item>
                        )}
                      </Key>
                      <Show when={group().foldable && !query().trim()}>
                        <MobileDrawer.Item
                          onClick={() => toggleProvider(group().label)}
                        >
                          <span class="flex size-4.5 shrink-0 items-center justify-center text-ink-subtle">
                            <Show
                              when={expanded(group().label)}
                              fallback={<CaretDown class="size-4.5" />}
                            >
                              <CaretUp class="size-4.5" />
                            </Show>
                          </span>
                          <span class="text-ink-muted">
                            {expanded(group().label)
                              ? t('agentControls.showFewerModels')
                              : t('agentControls.showAllModels', {
                                  count: group().options.length,
                                })}
                          </span>
                        </MobileDrawer.Item>
                      </Show>
                    </MobileDrawer.Section>
                  </div>
                )}
              </Key>
              <Show
                when={
                  modelGroups().length === 0 &&
                  selected().agents.length === 0 &&
                  !state.loading
                }
              >
                <p role="status" class="px-3 py-2.5 text-ink-subtle">
                  {t('agentControls.noMatches')}
                </p>
              </Show>
              <Show when={page() === 'list'}>
                <For each={agentPickerGroups(selected().agents)}>
                  {(group) => (
                    <div>
                      <MobileDrawer.Label>{group.label}</MobileDrawer.Label>
                      <MobileDrawer.Section>
                        <For each={group.agents}>
                          {(agent) => (
                            <MobileDrawer.Item
                              disabled={Boolean(
                                agent.unavailableReason && !agent.connectLabel
                              )}
                              onClick={() => {
                                if (agent.unavailableReason)
                                  state.onConnect?.(agent);
                                else state.onAgent?.(agent);
                                changeOpen(false);
                              }}
                            >
                              <span class="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-ink/5">
                                <AgentIcon agent={agent} class="size-[18px]" />
                              </span>
                              <span class="min-w-0 flex-1 truncate">
                                {agent.name}
                              </span>
                              <span class="text-sm text-ink-subtle">
                                {agent.runtime.label}
                              </span>
                              <Show when={state.agent?.id === agent.id}>
                                <Check class="size-4.5 text-accent" />
                              </Show>
                            </MobileDrawer.Item>
                          )}
                        </For>
                      </MobileDrawer.Section>
                    </div>
                  )}
                </For>
                <Show when={state.onCreate && !query().trim()}>
                  <MobileDrawer.Item
                    onClick={() => {
                      changeOpen(false);
                      state.onCreate?.();
                    }}
                  >
                    <Plus class="size-[18px]" />
                    {t('agentControls.createAgent')}
                  </MobileDrawer.Item>
                </Show>
              </Show>
            </Show>
            <Show when={page() === 'effort'}>
              <MobileDrawer.Section>
                <For each={state.effort?.options}>
                  {(choice) => (
                    <MobileDrawer.Item
                      disabled={state.effortDisabled}
                      onClick={() => {
                        if (state.effort && !state.effortDisabled)
                          state.onEffort({
                            configId: state.effort.id,
                            value: choice.value,
                            name: choice.name,
                          });
                        back();
                      }}
                    >
                      <span class="flex-1">{choice.name}</span>
                      <Show
                        when={
                          choice.value ===
                          (state.effortValue ?? state.effort?.currentValue)
                        }
                      >
                        <Check class="size-4.5 text-accent" />
                      </Show>
                    </MobileDrawer.Item>
                  )}
                </For>
              </MobileDrawer.Section>
            </Show>
            <Show when={page() === 'speed'}>
              <MobileDrawer.Section>
                <For each={speeds()}>
                  {(choice) => (
                    <MobileDrawer.Item
                      onClick={() => {
                        state.onSpeed(choice.value);
                        back();
                      }}
                    >
                      <span>{t(`agentControls.tier${choice.tier}`)}</span>
                      <Show when={choice.tier !== 'standard'}>
                        <span class="flex-1 text-sm text-ink-subtle">
                          {choice.tier === 'fast'
                            ? t('agentControls.usageFast')
                            : t('agentControls.usageUltrafast')}
                        </span>
                      </Show>
                      <Show when={choice.tier === 'standard'}>
                        <span class="flex-1" />
                      </Show>
                      <Show when={choice.value === state.speedValue}>
                        <Check class="size-4.5 text-accent" />
                      </Show>
                    </MobileDrawer.Item>
                  )}
                </For>
              </MobileDrawer.Section>
            </Show>
          </MobileDrawer.ScrollBody>
          <Show
            when={
              page() === 'list' && !query() && hasSelectorOptions(options())
            }
          >
            <MobileDrawer.Section class="mx-3 mb-3 shrink-0">
              <Show when={options().model}>
                <MobileDrawer.Item onClick={() => setPage('model')}>
                  <ModelIcon model={state.model} />
                  <span class="flex-1">{t('agentControls.model')}</span>
                  <CaretRight class="size-4" />
                </MobileDrawer.Item>
              </Show>
              <Show when={options().effort}>
                <MobileDrawer.Item
                  disabled={state.effortDisabled}
                  onClick={() => setPage('effort')}
                >
                  <Gauge class="size-[18px]" />
                  <span class="flex-1">
                    {t('agentControls.reasoningEffort')}
                  </span>
                  <span class="text-ink-subtle">
                    {
                      state.effort?.options.find(
                        (option) =>
                          option.value ===
                          (state.effortValue ?? state.effort?.currentValue)
                      )?.name
                    }
                  </span>
                  <CaretRight class="size-4" />
                </MobileDrawer.Item>
              </Show>
              <Show when={options().speed}>
                <MobileDrawer.Item onClick={() => setPage('speed')}>
                  <Lightning class="size-[18px]" />
                  <span class="flex-1">{t('agentControls.speed')}</span>
                  <span class="text-ink-subtle">
                    {t(`agentControls.tier${speedTier(state.speedValue)}`)}
                  </span>
                  <CaretRight class="size-4" />
                </MobileDrawer.Item>
              </Show>
            </MobileDrawer.Section>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
