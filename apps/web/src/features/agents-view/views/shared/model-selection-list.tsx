import { t } from '@app/lib/i18n';
import { matchesModelQuery } from '@core/component/AI/component/input/modelCatalog';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Check from '@icon/system/regular/check.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Squares from '@icon/system/regular/squares-four.svg';
import X from '@icon/system/regular/x.svg';
import { Button, Input } from '@ui';
import { cn } from '@ui/utils/classname';
import { createMemo, For, onMount, Show } from 'solid-js';
import { AgentIcon } from '../../components/AgentGlyph';
import { AgentBubble } from '../../components/agent-bubble/agent-bubble';
import { ModelRows } from '../../components/unified-model-selector/model-rows';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { agentPickerGroups } from '../../core/agent-picker-groups';
import { modelSelection } from '../../core/model-selection';
import { MACRO_PERSONA_ID, type RosterAgent } from '../../core/roster';
import type { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSelectorIdentity } from './model-selector-identity';

type Navigation = ReturnType<typeof createModelSelectorNavigation>;

/** Shared catalog body; desktop and phone own their separate overlay lifecycles. */
export function ModelSelectionList(props: {
  navigation: Navigation;
  mobile?: boolean;
  onPick: () => void;
  onBack: () => void;
}) {
  const state = useUnifiedModelSelector();
  const nav = props.navigation;
  let root: HTMLDivElement | undefined;
  let search: HTMLInputElement | undefined;
  const catalog = createMemo(() => state.suggestedModels);
  const agents = createMemo(() => state.agents ?? []);
  const filtered = createMemo(() =>
    modelSelection(catalog(), agents(), nav.query(), true)
  );
  const searching = () => Boolean(nav.query().trim());
  const auto = () =>
    catalog().find((model) => model.id.toLowerCase() === 'auto');
  const savedModels = () =>
    (state.recentModelIds ?? []).flatMap(
      (id) =>
        catalog().find((model) => model.id === id && model.id !== auto()?.id) ??
        []
    );
  const recent = () => {
    if (!savedModels().length)
      return filtered().suggested.filter((model) => model.id !== auto()?.id);
    const current = catalog().find(
      (model) => model.id === state.model && model.id !== auto()?.id
    );
    const ids = [
      ...new Set([
        ...(current ? [current.id] : []),
        ...savedModels().map((model) => model.id),
      ]),
    ];
    return ids
      .slice(0, 5)
      .flatMap((id) => catalog().find((model) => model.id === id) ?? []);
  };
  const customModels = () =>
    state.models.filter((model) =>
      matchesModelQuery(model, nav.query().trim().toLocaleLowerCase())
    );
  const noMatches = () => {
    if (!searching()) return false;
    if (nav.page() === 'all') return filtered().allModels.length === 0;
    if (nav.page() === 'agents') return filtered().agents.length === 0;
    return (
      filtered().suggested.length === 0 &&
      filtered().agents.length === 0 &&
      customModels().length === 0
    );
  };
  const bubbles = () => {
    if (searching()) return filtered().agents;
    const ids = state.recentAgentIds ?? [];
    const ordered = [...agents()].filter(
      (agent) => agent.id !== MACRO_PERSONA_ID
    );
    ordered.sort((a, b) => {
      const rank = (id: string) =>
        ids.includes(id) ? ids.indexOf(id) : ids.length;
      return rank(a.id) - rank(b.id);
    });
    return ordered.slice(0, props.mobile ? 4 : 5);
  };
  const pickModel = (id: string, override = false) => {
    if (state.disabled || (!override && state.suggestedDisabled)) return;
    const result = (
      override ? state.onModel : (state.onSuggestedModel ?? state.onModel)
    )(id);
    if (result instanceof Promise)
      fireAndForget(result, 'agents.model-selector');
    props.onPick();
  };
  const pickAgent = (agent: RosterAgent) => {
    if (state.disabled) return;
    if (agent.unavailableReason) {
      if (!agent.connectLabel) return;
      state.onConnect?.(agent);
    } else {
      const result = state.onAgent?.(agent);
      if (result instanceof Promise)
        fireAndForget(result, 'agents.model-selector');
    }
    props.onPick();
  };
  const focusRow = (last = false) => {
    const rows = root?.querySelectorAll<HTMLButtonElement>(
      '[data-model-choice]:not(:disabled)'
    );
    (last ? rows?.[rows.length - 1] : rows?.[0])?.focus();
  };
  onMount(() => {
    if (!props.mobile) search?.focus();
  });
  return (
    <div
      ref={root}
      class="flex min-h-0 flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Escape') return;
        if (event.target === search) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            focusRow(event.key === 'ArrowUp');
          }
          event.stopPropagation();
          return;
        }
        const buttons = Array.from(
          root?.querySelectorAll<HTMLButtonElement>(
            '[data-model-choice]:not(:disabled)'
          ) ?? []
        );
        const index = buttons.findIndex(
          (button) => button === document.activeElement
        );
        if (index < 0) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = index + (event.key === 'ArrowDown' ? 1 : -1);
          if (next < 0) search?.focus();
          else buttons[next % buttons.length]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          focusRow(event.key === 'End');
        }
      }}
    >
      <div class={cn('shrink-0 px-2 pt-2 pb-0', props.mobile && 'px-3 pb-3')}>
        <Button
          variant="ghost"
          appearance="bare"
          onClick={props.onBack}
          class={cn(
            'my-0.5 flex h-8 items-center gap-1.5 rounded-full pl-1.5 pr-2.5 not-touch:hover:bg-ink/12 text-sm',
            props.mobile && 'h-10 gap-2 pl-2 pr-3.5 text-base leading-[22px]'
          )}
        >
          <CaretLeft
            class={
              props.mobile
                ? 'size-[18px] text-ink-muted'
                : 'size-4 text-ink-muted'
            }
          />
          <Show
            when={nav.page() === 'list'}
            fallback={
              <span>
                {nav.page() === 'all'
                  ? t('agentControls.allModels')
                  : t('nav.agents')}
              </span>
            }
          >
            <ModelSelectorIdentity mobile={props.mobile} />
          </Show>
        </Button>
      </div>
      <div
        class={cn(
          'mx-3 my-1 flex h-9 shrink-0 items-center gap-2.5 rounded-[10px] bg-ink/8 px-3 focus-within:ring-1 focus-within:ring-accent',
          props.mobile && 'h-11 rounded-[22px] px-3.5'
        )}
      >
        <Search
          class={
            props.mobile
              ? 'size-[18px] text-ink-extra-muted'
              : 'size-4 text-ink-extra-muted'
          }
        />
        <Input
          ref={search}
          value={nav.query()}
          aria-label={t('agentControls.searchAgentsModels')}
          placeholder={t('agentControls.searchAgentsModels')}
          onInput={(event) => nav.setQuery(event.currentTarget.value)}
          class={cn(
            'min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 text-sm',
            props.mobile && 'text-base leading-[22px]'
          )}
        />
        <Show when={nav.query()}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('entityActions.clear')}
            onClick={() => {
              nav.setQuery('');
              search?.focus();
            }}
          >
            <X class="size-3.5" />
          </Button>
        </Show>
      </div>
      <div
        class="min-h-0 overflow-y-auto overscroll-contain pb-2"
        classList={{ 'px-1 pt-1': Boolean(props.mobile) }}
      >
        <Show when={nav.page() === 'list'}>
          <Show when={bubbles().length || (!searching() && state.onCreate)}>
            <div class="mx-2 mt-1 flex h-[30px] items-center justify-between px-2.5 text-xs text-ink-extra-muted">
              <span>{t('nav.agents')}</span>
              <Show when={!searching()}>
                <Button
                  variant="ghost"
                  appearance="bare"
                  size="xs"
                  class={cn(
                    '-mr-1.5 flex h-6 gap-0.5 rounded-md pl-2 pr-1.5 text-xs font-medium text-ink-muted not-touch:hover:bg-ink/12',
                    props.mobile &&
                      'h-7 min-h-7 touch:min-h-7 text-sm leading-5'
                  )}
                  onClick={() => {
                    nav.setPage('agents');
                    if (!props.mobile) search?.focus();
                  }}
                >
                  {t('agentControls.seeAll')}
                  <CaretRight class={props.mobile ? 'size-4' : 'size-3.5'} />
                </Button>
              </Show>
            </div>
            <div
              class="flex items-start px-3.5 pt-0.5 pb-1"
              classList={{
                'justify-between': !searching(),
                'gap-1': searching(),
              }}
            >
              <For each={bubbles()}>
                {(agent) => (
                  <AgentBubble
                    size={props.mobile ? 'selector-phone' : 'selector'}
                    agent={agent}
                    selected={state.agent?.id === agent.id}
                    disabled={
                      state.disabled ||
                      Boolean(agent.unavailableReason && !agent.connectLabel)
                    }
                    onSelect={() => pickAgent(agent)}
                  />
                )}
              </For>
              <Show when={!searching() && state.onCreate}>
                <AgentBubble
                  size={props.mobile ? 'selector-phone' : 'selector'}
                  disabled={state.disabled}
                  onSelect={() => {
                    props.onPick();
                    state.onCreate?.();
                  }}
                />
              </Show>
            </div>
          </Show>
          <Show when={!searching() && auto()}>
            {(option) => (
              <div class="px-2 pt-1 pb-2">
                <ModelRows
                  models={[option()]}
                  mobile={props.mobile}
                  selected={
                    state.suggestedSelected !== false ? state.model : undefined
                  }
                  disabled={state.disabled || state.suggestedDisabled}
                  onPick={pickModel}
                />
              </div>
            )}
          </Show>
          <div
            class="px-2 pb-2"
            classList={{ 'mt-8': searching() && bubbles().length > 0 }}
            role="group"
            aria-label={
              searching()
                ? t('agentControls.models')
                : savedModels().length
                  ? t('nav.recent')
                  : t('agentControls.suggested')
            }
          >
            <div class="flex h-[30px] items-center px-2.5 text-xs text-ink-extra-muted">
              {searching()
                ? t('agentControls.models')
                : savedModels().length
                  ? t('nav.recent')
                  : t('agentControls.suggested')}
            </div>
            <ModelRows
              models={searching() ? filtered().suggested : recent()}
              mobile={props.mobile}
              selected={
                state.suggestedSelected !== false ? state.model : undefined
              }
              disabled={state.disabled || state.suggestedDisabled}
              onPick={pickModel}
            />
            <Show when={!searching()}>
              <Button
                variant="ghost"
                appearance="bare"
                data-model-choice
                class={cn(
                  'flex min-h-9 w-full gap-2.5 rounded-lg px-2.5 py-2 text-sm not-touch:hover:bg-ink/12 focus-visible:bg-ink/12',
                  props.mobile && 'h-11 rounded-[22px] text-base leading-[22px]'
                )}
                onClick={() => {
                  nav.setPage('all');
                  if (!props.mobile) search?.focus();
                }}
              >
                <Squares class={props.mobile ? 'size-[18px]' : 'size-4'} />
                <span class="flex-1 text-left">
                  {t('agentControls.moreModels')}
                </span>
                <CaretRight
                  class={
                    props.mobile
                      ? 'size-[18px] text-ink-extra-muted'
                      : 'size-3.5 text-ink-extra-muted'
                  }
                />
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={nav.page() === 'all'}>
          <For each={filtered().allProviders}>
            {(group) => (
              <div class="px-2 pb-2" role="group" aria-label={group.label}>
                <div class="flex h-[30px] items-center gap-2 px-2.5 text-xs text-ink-extra-muted">
                  <ModelIcon model={group.options[0]?.id} class="size-4" />
                  {group.label}
                </div>
                <ModelRows
                  models={group.options}
                  mobile={props.mobile}
                  showLogos={false}
                  selected={
                    state.suggestedSelected !== false ? state.model : undefined
                  }
                  disabled={state.disabled || state.suggestedDisabled}
                  onPick={pickModel}
                />
              </div>
            )}
          </For>
        </Show>
        <Show when={nav.page() === 'agents'}>
          <For each={agentPickerGroups(filtered().agents)}>
            {(group) => (
              <div class="px-2 pb-2" role="group" aria-label={group.label}>
                <div class="flex h-[30px] items-center px-2.5 text-xs text-ink-extra-muted">
                  {group.label}
                </div>
                <For each={group.agents}>
                  {(agent) => (
                    <Button
                      variant="ghost"
                      appearance="bare"
                      data-model-choice
                      class={cn(
                        'flex min-h-9 w-full gap-2.5 rounded-lg px-2.5 py-2 text-sm font-normal not-touch:hover:bg-ink/12',
                        props.mobile &&
                          'h-11 rounded-[22px] text-base leading-[22px]'
                      )}
                      disabled={
                        state.disabled ||
                        Boolean(agent.unavailableReason && !agent.connectLabel)
                      }
                      onClick={() => pickAgent(agent)}
                    >
                      <AgentIcon agent={agent} class="size-4" />
                      <span class="flex-1 text-left">{agent.name}</span>
                      <span class="text-xs text-ink-extra-muted">
                        {agent.connectLabel ?? agent.runtime.label}
                      </span>
                      <Show when={state.agent?.id === agent.id}>
                        <Check class="size-3.5 text-accent" />
                      </Show>
                    </Button>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
        <Show
          when={
            nav.page() === 'list' &&
            state.agent &&
            state.agent.id !== MACRO_PERSONA_ID &&
            state.models.length > 1
          }
        >
          <div
            class="px-2 pb-2"
            role="group"
            aria-label={t('agentControls.model')}
          >
            <div class="flex h-[30px] items-center px-2.5 text-xs text-ink-extra-muted">
              {t('agentControls.model')}
            </div>
            <ModelRows
              models={customModels()}
              mobile={props.mobile}
              selected={state.model}
              disabled={state.disabled}
              onPick={(id) => pickModel(id, true)}
            />
          </div>
        </Show>
        <Show when={noMatches()}>
          <p role="status" class="p-3 text-sm text-ink-extra-muted">
            {t('agentControls.noMatches')}
          </p>
        </Show>
      </div>
    </div>
  );
}
