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
import { createMemo, For, onCleanup, onMount, Show } from 'solid-js';
import { AgentAvatar } from '../../components/AgentGlyph';
import { AgentBubble } from '../../components/agent-bubble/agent-bubble';
import { ModelRows } from '../../components/unified-model-selector/model-rows';
import {
  type SelectorActionResult,
  useUnifiedModelSelector,
} from '../../components/unified-model-selector/root';
import { ModelSelectionSection } from '../../components/unified-model-selector/selection-section';
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
  const auto = () => filtered().auto;
  const searchModels = () =>
    filtered().allModels.filter((model) => model !== auto());
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
    search?.focus({ preventScroll: true });
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
  let selection = 0;
  onCleanup(() => selection++);
  const finishPick = (result: SelectorActionResult) => {
    const version = ++selection;
    const page = nav.page();
    const finish = (applied: void | boolean) => {
      if (
        applied !== false &&
        version === selection &&
        nav.open() &&
        nav.page() === page
      )
        props.onPick();
    };
    if (result instanceof Promise) {
      const settle = async () => finish(await result);
      fireAndForget(settle(), 'agents.model-selector');
    } else finish(result);
  };
  const pickModel = (id: string, override = false) => {
    if (state.disabled || (!override && state.suggestedDisabled)) return;
    finishPick(
      (override ? state.onModel : (state.onSuggestedModel ?? state.onModel))(id)
    );
  };
  const pickAgent = (agent: RosterAgent) => {
    if (state.disabled) return;
    if (agent.unavailableReason) {
      if (!agent.connectLabel) return;
      state.onConnect?.(agent);
      props.onPick();
    } else finishPick(state.onAgent?.(agent));
  };
  const focusRow = (last = false) => {
    const rows = root?.querySelectorAll<HTMLButtonElement>(
      '[data-model-choice]:not(:disabled)'
    );
    (last ? rows?.[rows.length - 1] : rows?.[0])?.focus();
  };
  onMount(() => {
    if (!props.mobile) search?.focus({ preventScroll: true });
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
        const active = document.activeElement;
        const index =
          active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1;
        if (index < 0) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = index + (event.key === 'ArrowDown' ? 1 : -1);
          if (next < 0) search?.focus({ preventScroll: true });
          else buttons[next % buttons.length]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          focusRow(event.key === 'End');
        }
      }}
    >
      <div
        class={cn(
          'flex shrink-0 flex-col',
          props.mobile ? 'gap-0' : 'gap-1.5 pb-1'
        )}
      >
        <div class={cn('px-2 pt-2.5', props.mobile && 'px-3 py-2.5')}>
          <Button
            variant="ghost"
            appearance="bare"
            onClick={props.onBack}
            class={cn(
              'flex h-8 items-center gap-1.5 rounded-full pl-1.5 pr-2.5 not-touch:hover:bg-hover active:bg-active text-sm',
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
        <div class="px-3">
          <div
            class={cn(
              'flex h-9 items-center gap-2.5 rounded-[10px] bg-active px-3 focus-within:ring-1 focus-within:ring-accent',
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
        </div>
      </div>
      <div
        class={cn(
          'min-h-0 overflow-y-auto overscroll-contain px-2 pb-4',
          props.mobile && 'px-3 pt-1.5',
          !props.mobile && nav.page() === 'list' && 'pt-3',
          !props.mobile && nav.page() !== 'list' && 'pt-2'
        )}
      >
        <Show when={nav.page() === 'list'}>
          <div
            class={cn(
              'flex flex-col',
              searching() && !auto() ? 'gap-8' : 'gap-6'
            )}
          >
            <Show when={bubbles().length || (!searching() && state.onCreate)}>
              <ModelSelectionSection
                title={t('nav.agents')}
                mobile={props.mobile}
                bubbles
                action={
                  <Show when={!searching()}>
                    <Button
                      variant="link"
                      size="xs"
                      class={cn(
                        'h-4 min-h-0 gap-0.5 p-0 leading-4 touch:min-h-0 not-data-disabled:hover:no-underline',
                        props.mobile && 'h-5 text-sm leading-5'
                      )}
                      onClick={() => {
                        nav.setPage('agents');
                        if (!props.mobile)
                          search?.focus({ preventScroll: true });
                      }}
                    >
                      {t('agentControls.seeAll')}
                      <ArrowRight
                        aria-hidden="true"
                        class="size-3.5 shrink-0"
                      />
                    </Button>
                  </Show>
                }
              >
                <div
                  class="flex items-start gap-1 px-1.5 pt-0.5"
                  classList={{ 'justify-between': !searching() }}
                >
                  <For each={bubbles()}>
                    {(agent) => (
                      <AgentBubble
                        size={props.mobile ? 'selector-phone' : 'selector'}
                        agent={agent}
                        selected={state.agent?.id === agent.id}
                        disabled={
                          state.disabled ||
                          Boolean(
                            agent.unavailableReason && !agent.connectLabel
                          )
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
              </ModelSelectionSection>
            </Show>
            <Show when={auto() || searchModels().length || !searching()}>
              <div class="flex flex-col gap-4">
                <Show when={auto()}>
                  {(option) => (
                    <ModelSelectionSection mobile={props.mobile}>
                      <ModelRows
                        models={[option()]}
                        mobile={props.mobile}
                        selected={
                          state.suggestedSelected !== false
                            ? state.model
                            : undefined
                        }
                        disabled={state.disabled || state.suggestedDisabled}
                        onPick={pickModel}
                      />
                    </ModelSelectionSection>
                  )}
                </Show>
                <Show when={searching() && searchModels().length > 0}>
                  <ModelSelectionSection
                    title={t('agentControls.models')}
                    mobile={props.mobile}
                  >
                    <ModelRows
                      models={searchModels()}
                      mobile={props.mobile}
                      selected={
                        state.suggestedSelected !== false
                          ? state.model
                          : undefined
                      }
                      disabled={state.disabled || state.suggestedDisabled}
                      onPick={pickModel}
                    />
                  </ModelSelectionSection>
                </Show>
                <Show when={!searching()}>
                  <Show when={recent().length}>
                    <ModelSelectionSection
                      title={t('nav.recent')}
                      mobile={props.mobile}
                    >
                      <ModelRows
                        models={recent()}
                        mobile={props.mobile}
                        selected={
                          state.suggestedSelected !== false
                            ? state.model
                            : undefined
                        }
                        disabled={state.disabled || state.suggestedDisabled}
                        onPick={pickModel}
                      />
                    </ModelSelectionSection>
                  </Show>
                  <Show when={suggested().length}>
                    <ModelSelectionSection
                      title={t('agentControls.suggested')}
                      mobile={props.mobile}
                    >
                      <ModelRows
                        models={suggested()}
                        mobile={props.mobile}
                        selected={
                          state.suggestedSelected !== false
                            ? state.model
                            : undefined
                        }
                        disabled={state.disabled || state.suggestedDisabled}
                        onPick={pickModel}
                      />
                    </ModelSelectionSection>
                  </Show>
                  <ModelSelectionSection mobile={props.mobile}>
                    <Button
                      variant="ghost"
                      appearance="bare"
                      data-model-choice
                      class={cn(
                        'flex min-h-9 w-full gap-2.5 rounded-lg px-2.5 py-2 text-sm not-touch:hover:bg-hover focus-visible:bg-active',
                        props.mobile &&
                          'h-11 rounded-[22px] text-base leading-[22px]'
                      )}
                      onClick={() => {
                        nav.setPage('all');
                        if (!props.mobile)
                          search?.focus({ preventScroll: true });
                      }}
                    >
                      <Squares
                        class={props.mobile ? 'size-[18px]' : 'size-4'}
                      />
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
                  </ModelSelectionSection>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={nav.page() === 'all'}>
          <div class="flex flex-col gap-4">
            <Show when={auto()}>
              {(option) => (
                <ModelSelectionSection mobile={props.mobile}>
                  <ModelRows
                    models={[option()]}
                    mobile={props.mobile}
                    selected={
                      state.suggestedSelected !== false
                        ? state.model
                        : undefined
                    }
                    disabled={state.disabled || state.suggestedDisabled}
                    onPick={pickModel}
                  />
                </ModelSelectionSection>
              )}
            </Show>
            <For each={filtered().allProviders}>
              {(group) => (
                <ModelSelectionSection
                  title={group.label}
                  mobile={props.mobile}
                >
                  <ModelRows
                    models={group.options}
                    mobile={props.mobile}
                    selected={
                      state.suggestedSelected !== false
                        ? state.model
                        : undefined
                    }
                    disabled={state.disabled || state.suggestedDisabled}
                    onPick={pickModel}
                  />
                </ModelSelectionSection>
              )}
            </For>
          </div>
        </Show>
        <Show when={nav.page() === 'agents'}>
          <div class="flex flex-col gap-4">
            <For each={agentPickerGroups(filtered().agents)}>
              {(group) => (
                <ModelSelectionSection
                  title={group.label}
                  mobile={props.mobile}
                >
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
                          Boolean(
                            agent.unavailableReason && !agent.connectLabel
                          )
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
                </ModelSelectionSection>
              )}
            </For>
          </div>
        </Show>
        <Show when={nav.page() === 'agentModels'}>
          <div class="flex flex-col gap-4">
            <Show when={agentModels().auto}>
              {(option) => (
                <ModelSelectionSection mobile={props.mobile}>
                  <ModelRows
                    models={[option()]}
                    mobile={props.mobile}
                    selected={state.model}
                    disabled={state.disabled}
                    onPick={(id) => pickModel(id, true)}
                  />
                </ModelSelectionSection>
              )}
            </Show>
            <For each={agentModels().allProviders}>
              {(group) => (
                <ModelSelectionSection
                  title={group.label}
                  mobile={props.mobile}
                >
                  <ModelRows
                    models={group.options}
                    mobile={props.mobile}
                    selected={state.model}
                    disabled={state.disabled}
                    onPick={(id) => pickModel(id, true)}
                  />
                </ModelSelectionSection>
              )}
            </For>
          </div>
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
