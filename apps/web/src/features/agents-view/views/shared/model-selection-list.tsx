import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowRight from '@icon/system/regular/arrow-right.svg';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import Check from '@icon/system/regular/check.svg';
import Search from '@icon/system/regular/magnifying-glass.svg';
import Plus from '@icon/system/regular/plus.svg';
import Squares from '@icon/system/regular/squares-four.svg';
import { Button, InputGroup, Menu } from '@ui';
import { createMemo, For, onCleanup, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { AgentAvatar } from '../../components/AgentGlyph';
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
  const quickAgents = () => {
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
      class="flex min-h-0 flex-col gap-2"
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
      <Dynamic
        component={props.mobile ? MobileDrawer.Section : Menu.Group}
        class="gap-2"
      >
        <Button
          variant="ghost"
          size="xs"
          onClick={props.onBack}
          class="self-start min-w-0"
        >
          <CaretLeft class="size-4 shrink-0" />
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
            <ModelSelectorIdentity />
          </Show>
        </Button>
        <InputGroup data-corvu-no-drag>
          <InputGroup.Input
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
          />
          <InputGroup.Addon align="inline-start">
            <Search class="size-4" />
          </InputGroup.Addon>
          <InputGroup.Addon align="inline-end">
            <InputGroup.ClearButton />
          </InputGroup.Addon>
        </InputGroup>
      </Dynamic>
      <div class="min-h-0 overflow-y-auto overscroll-contain">
        <Show when={nav.page() === 'list'}>
          <div class="flex flex-col gap-2">
            <Show
              when={quickAgents().length || (!searching() && state.onCreate)}
            >
              <ModelSelectionSection
                title={t('nav.agents')}
                mobile={props.mobile}
                action={
                  <Show when={!searching()}>
                    <Button
                      variant="link"
                      size="xs"
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
                <For each={quickAgents()}>
                  {(agent) => (
                    <Dynamic
                      component={props.mobile ? MobileDrawer.Item : Menu.Item}
                      data-model-choice
                      aria-pressed={state.agent?.id === agent.id}
                      disabled={
                        state.disabled ||
                        Boolean(agent.unavailableReason && !agent.connectLabel)
                      }
                      onClick={() => pickAgent(agent)}
                    >
                      <AgentAvatar
                        agent={agent}
                        coder={false}
                        class="size-4"
                        iconClass="size-4"
                      />
                      <span class="min-w-0 flex-1 truncate">{agent.name}</span>
                      <Show when={state.agent?.id === agent.id}>
                        <Check class="size-4 shrink-0" />
                      </Show>
                    </Dynamic>
                  )}
                </For>
                <Show when={!searching() && state.onCreate}>
                  <Dynamic
                    component={props.mobile ? MobileDrawer.Item : Menu.Item}
                    data-model-choice
                    disabled={state.disabled}
                    onClick={() => {
                      props.onPick();
                      state.onCreate?.();
                    }}
                  >
                    <Plus class="size-4 shrink-0" />
                    <span>{t('create.new')}</span>
                  </Dynamic>
                </Show>
              </ModelSelectionSection>
            </Show>
            <Show when={auto() || searchModels().length || !searching()}>
              <div class="flex flex-col gap-2">
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
                    <Dynamic
                      component={props.mobile ? MobileDrawer.Item : Menu.Item}
                      data-model-choice
                      onClick={() => {
                        nav.setPage('all');
                        if (!props.mobile)
                          search?.focus({ preventScroll: true });
                      }}
                    >
                      <Squares class="size-4 shrink-0" />
                      <span class="flex-1">
                        {t('agentControls.moreModels')}
                      </span>
                      <CaretRight class="size-4 shrink-0" />
                    </Dynamic>
                  </ModelSelectionSection>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={nav.page() === 'all'}>
          <div class="flex flex-col gap-2">
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
          <div class="flex flex-col gap-2">
            <For each={agentPickerGroups(filtered().agents)}>
              {(group) => (
                <ModelSelectionSection
                  title={group.label}
                  mobile={props.mobile}
                >
                  <For each={group.agents}>
                    {(agent) => (
                      <Dynamic
                        component={props.mobile ? MobileDrawer.Item : Menu.Item}
                        data-model-choice
                        aria-pressed={state.agent?.id === agent.id}
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
                          class="size-4"
                          iconClass="size-4"
                        />
                        <span class="flex-1 text-left">{agent.name}</span>
                        <span class="text-xs text-ink-extra-muted">
                          {agent.connectLabel ?? agent.runtime.label}
                        </span>
                        <Show when={state.agent?.id === agent.id}>
                          <Check class="size-4 shrink-0" />
                        </Show>
                      </Dynamic>
                    )}
                  </For>
                </ModelSelectionSection>
              )}
            </For>
          </div>
        </Show>
        <Show when={nav.page() === 'agentModels'}>
          <div class="flex flex-col gap-2">
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
          <div class="flex min-w-0 flex-col items-center gap-3 p-4">
            <Search aria-hidden="true" class="size-5 text-ink-extra-muted" />
            <p
              role="status"
              class="flex max-w-full min-w-0 text-sm text-ink-muted"
            >
              <span class="min-w-0 truncate">
                {t('agentControls.noMatchesFor', { query: nav.query() })}
              </span>
            </p>
            <Button
              variant="ghost"
              size="xs"
              data-model-choice
              onClick={clearSearch}
            >
              {t('agentControls.clearSearch')}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}
