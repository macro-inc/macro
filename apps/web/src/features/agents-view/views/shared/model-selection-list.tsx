import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowRight from '@icon/system/regular/arrow-right.svg';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Check from '@icon/system/regular/check.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Squares from '@icon/system/regular/squares-four.svg';
import X from '@icon/system/regular/x.svg';
import { Button, Input } from '@ui';
import { cn } from '@ui/utils/classname';
import { createMemo, For, onMount, Show } from 'solid-js';
import { AgentAvatar } from '../../components/AgentGlyph';
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
    const current = catalog().find(
      (model) => model.id === state.model && model.id !== auto()?.id
    );
    const ids = [
      ...new Set([
        ...(current && savedModels().length ? [current.id] : []),
        ...savedModels().map((model) => model.id),
      ]),
    ];
    return ids
      .slice(0, 5)
      .flatMap((id) => catalog().find((model) => model.id === id) ?? []);
  };
  const suggested = () => {
    const recentIds = new Set(recent().map((model) => model.id));
    return filtered()
      .suggested.filter(
        (model) => model.id !== auto()?.id && !recentIds.has(model.id)
      )
      .slice(0, 5);
  };
  const agentModels = createMemo(() =>
    modelSelection(state.models, [], nav.query(), true)
  );
  const clearSearch = () => {
    nav.setQuery('');
    search?.focus();
  };
  const noMatches = () => {
    if (!searching()) return false;
    if (nav.page() === 'all') return filtered().allModels.length === 0;
    if (nav.page() === 'agentModels')
      return agentModels().allModels.length === 0;
    if (nav.page() === 'agents') return filtered().agents.length === 0;
    return filtered().allModels.length === 0 && filtered().agents.length === 0;
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
      <div class={cn('shrink-0 px-2 pt-2 pb-0', props.mobile && 'px-3 py-2')}>
        <Button
          variant="ghost"
          appearance="bare"
          onClick={props.onBack}
          class={cn(
            'my-0.5 flex h-8 items-center gap-1.5 rounded-full pl-1.5 pr-2.5 not-touch:hover:bg-hover active:bg-active text-sm',
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
            when={nav.page() === 'list' || nav.page() === 'agentModels'}
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
          'mx-3 my-1 flex h-9 shrink-0 items-center gap-2.5 rounded-[10px] bg-active px-3 focus-within:ring-1 focus-within:ring-accent',
          props.mobile && 'my-0 h-11 rounded-[22px] px-3.5'
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
          aria-label={
            nav.page() === 'agentModels'
              ? t('agentControls.searchModels')
              : t('agentControls.searchAgentsModels')
          }
          placeholder={
            nav.page() === 'agentModels'
              ? t('agentControls.searchModels')
              : t('agentControls.searchAgentsModels')
          }
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
            onClick={clearSearch}
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
            <div class="mx-2 mt-1 flex items-center justify-between px-2.5 pt-2 pb-1 text-xs text-ink-extra-muted">
              <span>{t('nav.agents')}</span>
              <Show when={!searching()}>
                <Button
                  variant="link"
                  size="xs"
                  class={cn(
                    '-mr-1.5 -my-1 not-data-disabled:hover:no-underline',
                    props.mobile && '-my-0.5 text-sm'
                  )}
                  onClick={() => {
                    nav.setPage('agents');
                    if (!props.mobile) search?.focus();
                  }}
                >
                  {t('agentControls.seeAll')}
                  <ArrowRight aria-hidden="true" class="size-3.5 shrink-0" />
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
              <ModelRows
                class="mx-2 mt-4 mb-2 w-[calc(100%-1rem)]"
                models={[option()]}
                mobile={props.mobile}
                selected={
                  state.suggestedSelected !== false ? state.model : undefined
                }
                disabled={state.disabled || state.suggestedDisabled}
                onPick={pickModel}
              />
            )}
          </Show>
          <Show when={searching() && filtered().allModels.length > 0}>
            <div
              class="px-2 pb-2"
              classList={{ 'mt-4': bubbles().length > 0 }}
              role="group"
              aria-label={t('agentControls.models')}
            >
              <div class="px-2.5 pt-2 pb-1 text-xs text-ink-extra-muted">
                {t('agentControls.models')}
              </div>
              <ModelRows
                models={filtered().allModels}
                mobile={props.mobile}
                selected={
                  state.suggestedSelected !== false ? state.model : undefined
                }
                disabled={state.disabled || state.suggestedDisabled}
                onPick={pickModel}
              />
            </div>
          </Show>
          <Show when={!searching()}>
            <Show when={recent().length}>
              <div class="px-2 pb-2" role="group" aria-label={t('nav.recent')}>
                <div class="px-2.5 pt-2 pb-1 text-xs text-ink-extra-muted">
                  {t('nav.recent')}
                </div>
                <ModelRows
                  models={recent()}
                  mobile={props.mobile}
                  selected={
                    state.suggestedSelected !== false ? state.model : undefined
                  }
                  disabled={state.disabled || state.suggestedDisabled}
                  onPick={pickModel}
                />
              </div>
            </Show>
            <Show when={suggested().length}>
              <div
                class="px-2 pb-2"
                role="group"
                aria-label={t('agentControls.suggested')}
              >
                <div class="px-2.5 pt-2 pb-1 text-xs text-ink-extra-muted">
                  {t('agentControls.suggested')}
                </div>
                <ModelRows
                  models={suggested()}
                  mobile={props.mobile}
                  selected={
                    state.suggestedSelected !== false ? state.model : undefined
                  }
                  disabled={state.disabled || state.suggestedDisabled}
                  onPick={pickModel}
                />
              </div>
            </Show>
            <div class="px-2 pb-2">
              <Button
                variant="ghost"
                appearance="bare"
                data-model-choice
                class={cn(
                  'flex min-h-9 w-full gap-2.5 rounded-lg px-2.5 py-2 text-sm not-touch:hover:bg-hover focus-visible:bg-active',
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
            </div>
          </Show>
        </Show>
        <Show when={nav.page() === 'all'}>
          <For each={filtered().allProviders}>
            {(group) => (
              <div class="px-2 pb-2" role="group" aria-label={group.label}>
                <div class="px-2.5 pt-2 pb-1 text-xs text-ink-extra-muted">
                  {group.label}
                </div>
                <ModelRows
                  models={group.options}
                  mobile={props.mobile}
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
                <div class="px-2.5 pt-2 pb-1 text-xs text-ink-extra-muted">
                  {group.label}
                </div>
                <For each={group.agents}>
                  {(agent) => (
                    <Button
                      variant="ghost"
                      appearance="bare"
                      data-model-choice
                      class={cn(
                        'flex min-h-9 w-full gap-2.5 rounded-lg px-2.5 py-2 text-sm font-normal not-touch:hover:bg-hover',
                        props.mobile &&
                          'h-11 rounded-[22px] text-base leading-[22px]'
                      )}
                      disabled={
                        state.disabled ||
                        Boolean(agent.unavailableReason && !agent.connectLabel)
                      }
                      onClick={() => pickAgent(agent)}
                    >
                      <AgentAvatar
                        agent={agent}
                        coder={false}
                        class="size-[18px]"
                        iconClass="size-4"
                      />
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
        <Show when={nav.page() === 'agentModels'}>
          <For each={agentModels().allProviders}>
            {(group) => (
              <div class="px-2 pb-2" role="group" aria-label={group.label}>
                <div class="px-2.5 pt-2 pb-1 text-xs text-ink-extra-muted">
                  {group.label}
                </div>
                <ModelRows
                  models={group.options}
                  mobile={props.mobile}
                  selected={state.model}
                  disabled={state.disabled}
                  onPick={(id) => pickModel(id, true)}
                />
              </div>
            )}
          </For>
        </Show>
        <Show when={noMatches()}>
          <div
            class={cn(
              'flex min-w-0 flex-col items-center gap-3 px-4 py-6',
              props.mobile && 'py-8'
            )}
          >
            <Search
              aria-hidden="true"
              class={cn(
                'size-5 text-ink-extra-muted',
                props.mobile && 'size-6'
              )}
            />
            <p
              role="status"
              class={cn(
                'flex max-w-full min-w-0 text-sm text-ink-muted',
                props.mobile && 'text-base leading-[22px]'
              )}
            >
              <span class="min-w-0 truncate">
                {t('agentControls.noMatchesFor', { query: nav.query() })}
              </span>
            </p>
            <Button
              variant="secondary"
              size="sm"
              data-model-choice
              onClick={clearSearch}
              class={cn(
                'h-6 min-h-6 rounded-full px-2.5 text-xs text-ink-muted',
                props.mobile && 'h-9 min-h-9 px-3.5 text-sm'
              )}
            >
              {t('agentControls.clearSearch')}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}
