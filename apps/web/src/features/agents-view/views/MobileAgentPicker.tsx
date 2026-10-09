import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  buildModelCatalog,
  matchesModelQuery,
} from '@core/component/AI/component/input/modelCatalog';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { modelLabel } from '@core/component/AI/constant/model-label';
import ArrowLeft from '@phosphor/arrow-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Plus from '@phosphor/plus.svg';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { AgentIcon } from '../components/AgentGlyph';
import { AgentPickerIdentity } from '../components/AgentPickerIdentity';
import { agentPickerGroups } from '../core/agent-picker-groups';
import { MACRO_PERSONA_ID, type RosterAgent } from '../core/roster';
import { createComposerModels } from '../queries/composer-models';
import type { AgentPickerProps } from './AgentPicker';

/** A single sheet drills into models without hover menus or offscreen submenus. */
export function MobileAgentPicker(props: AgentPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [showAll, setShowAll] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;
  const [browsing, setBrowsing] = createSignal<RosterAgent>();
  const macro = () =>
    props.agents.find((agent) => agent.id === MACRO_PERSONA_ID);
  const catalog = createComposerModels(() => browsing() ?? macro());
  const model = () => props.modelOverride ?? props.selected?.defaultModel;
  const label = () =>
    props.selected?.id === MACRO_PERSONA_ID
      ? modelLabel(model())
      : (props.selected?.name ?? 'Choose agent');
  const matches = (text: string) =>
    text.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase());
  const modelSections = createMemo(() => {
    const options = catalog.models().map((option) => ({
      id: option.id,
      label: modelLabel(option.id, option.name),
      group: option.group ?? undefined,
    }));
    const { frontier, providers } = buildModelCatalog(options, true);
    const search = query().trim().toLowerCase();
    return (
      showAll() || search || frontier.length === 0
        ? providers
        : [{ label: 'Suggested', options: frontier }]
    )
      .map((section) => ({
        label: section.label,
        options: section.options.filter((option) =>
          matchesModelQuery(option, search)
        ),
      }))
      .filter((section) => section.options.length > 0);
  });
  const groups = () =>
    agentPickerGroups(
      props.agents.filter((agent) =>
        matches(`${agent.name} ${agent.runtime.label}`)
      )
    );
  const searchLabel = () =>
    browsing() || showAll()
      ? 'Search models'
      : macro()
        ? 'Search agents and models'
        : 'Search agents';
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setBrowsing(undefined);
      setShowAll(false);
    }
  };
  const choose = (agent: RosterAgent, model?: string) => {
    props.onSelect(agent, model);
    changeOpen(false);
  };
  const browse = (agent?: RosterAgent) => {
    setQuery('');
    setBrowsing(agent);
    setShowAll(false);
    searchInput?.focus();
  };
  return (
    <MobileDrawer side="bottom" open={open()} onOpenChange={changeOpen}>
      <MobileDrawer.Trigger
        as={Button}
        variant="ghost"
        size="sm"
        aria-label="Agent"
        title={label()}
        class="size-[34px] shrink-0 rounded-full p-0 text-ink-muted"
        // Let click open the sheet before any native focus can move the trigger.
        // Physical iOS devices also send mousedown after a cancelled pointerdown.
        onPointerDown={(event: PointerEvent) => event.preventDefault()}
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
      >
        {/* Icon only on a phone; the title and the sheet name the choice. */}
        <Show
          when={props.selected?.id !== MACRO_PERSONA_ID && props.selected}
          fallback={<ModelIcon model={model()} class="size-[18px]" />}
        >
          {(agent) => <AgentIcon agent={agent()} class="size-[18px]" />}
        </Show>
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Choose an agent or model">
          <MobileDrawer.Handle />
          <div class="flex items-center gap-2 px-4 pb-3">
            <Show when={browsing() || showAll()}>
              <Button
                variant="ghost"
                size="icon-md"
                label={showAll() ? 'Back to Suggested' : 'Back to agents'}
                onClick={() => {
                  if (showAll()) {
                    setShowAll(false);
                    setQuery('');
                    searchInput?.focus();
                  } else browse();
                }}
              >
                <ArrowLeft />
              </Button>
            </Show>
            <h2 class="min-w-0 flex-1 truncate font-medium">
              {showAll()
                ? 'All models'
                : (browsing()?.name ??
                  (macro() ? 'Agents and models' : 'Choose an agent'))}
            </h2>
            <Show when={browsing()}>
              {(agent) => (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Use ${agent().name} default`}
                  onClick={() => choose(agent())}
                >
                  Use default
                </Button>
              )}
            </Show>
          </div>
          <div class="mx-4 mb-2 flex h-9 shrink-0 items-center gap-2 px-3">
            <MagnifyingGlass
              aria-hidden="true"
              class="size-4 shrink-0 text-ink-extra-muted"
            />
            <input
              ref={searchInput}
              aria-label={searchLabel()}
              placeholder={searchLabel()}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              class="h-full min-w-0 w-full border-0 bg-transparent p-0 text-base outline-none placeholder:text-ink-extra-muted"
            />
          </div>
          <MobileDrawer.ScrollBody class="gap-1">
            <Show when={browsing() ?? macro()}>
              <For each={modelSections()}>
                {(section) => (
                  <div>
                    <MobileDrawer.Label class="px-4 pb-1 font-medium text-ink-muted">
                      {section.label}
                    </MobileDrawer.Label>
                    <MobileDrawer.Section
                      class="rounded-none bg-transparent p-0"
                      role="group"
                      aria-label={section.label}
                    >
                      <For each={section.options}>
                        {(option) => (
                          <MobileDrawer.Item
                            disabled={Boolean(
                              (browsing() ?? macro())?.unavailableReason
                            )}
                            onClick={() => {
                              const agent = browsing() ?? macro();
                              if (agent) choose(agent, option.id);
                            }}
                          >
                            <ModelIcon model={option.id} />
                            <span class="min-w-0 flex-1 truncate">
                              {option.label}
                            </span>
                            <Show
                              when={
                                props.selected?.id ===
                                  (browsing() ?? macro())?.id &&
                                model() === option.id
                              }
                            >
                              <Check class="size-4 text-accent" />
                            </Show>
                          </MobileDrawer.Item>
                        )}
                      </For>
                    </MobileDrawer.Section>
                  </div>
                )}
              </For>
              <Show
                when={
                  !showAll() &&
                  !query() &&
                  modelSections().some(
                    (section) => section.label === 'Suggested'
                  )
                }
              >
                <MobileDrawer.Item
                  onClick={() => {
                    setShowAll(true);
                    searchInput?.focus();
                  }}
                >
                  <span class="flex-1">More models</span>
                  <CaretRight class="size-4" />
                </MobileDrawer.Item>
              </Show>
              <Show when={modelSections().length === 0}>
                <p role="status" class="px-4 py-3 text-sm text-ink-muted">
                  {query() ? 'No matching models' : catalog.message()}
                </p>
              </Show>
            </Show>
            <Show when={!browsing() && !showAll()}>
              <For each={groups()}>
                {(group) => (
                  <div>
                    <MobileDrawer.Label class="px-4 pb-1 font-medium text-ink-muted">
                      {group.label}
                    </MobileDrawer.Label>
                    <MobileDrawer.Section
                      class="rounded-none bg-transparent p-0"
                      role="group"
                      aria-label={group.label}
                    >
                      <For each={group.agents}>
                        {(agent) => (
                          <div class="flex items-center">
                            <MobileDrawer.Item
                              class="min-w-0 flex-1"
                              disabled={Boolean(
                                agent.unavailableReason && !agent.connectLabel
                              )}
                              onClick={() => {
                                if (agent.unavailableReason) {
                                  changeOpen(false);
                                  props.onConnect(agent);
                                } else choose(agent);
                              }}
                            >
                              <AgentPickerIdentity
                                agent={agent}
                                selected={props.selected?.id === agent.id}
                                model={
                                  props.selected?.id === agent.id
                                    ? props.modelOverride
                                    : undefined
                                }
                              />
                            </MobileDrawer.Item>
                            <Show when={!agent.unavailableReason}>
                              <Button
                                variant="ghost"
                                size="icon-md"
                                class="mr-1 size-11 shrink-0"
                                label={`Models for ${agent.name}`}
                                onClick={() => browse(agent)}
                              >
                                <CaretRight />
                              </Button>
                            </Show>
                          </div>
                        )}
                      </For>
                    </MobileDrawer.Section>
                  </div>
                )}
              </For>
              <Show when={!props.loading && !macro() && groups().length === 0}>
                <p role="status" class="px-4 py-3 text-sm text-ink-muted">
                  {query() ? 'No matching agents' : 'No agents available'}
                </p>
              </Show>
              <Show when={props.loading}>
                <p role="status" class="px-4 py-3 text-sm text-ink-muted">
                  Loading agents…
                </p>
              </Show>
            </Show>
            <div class="flex justify-end px-4 pt-1">
              <Button
                variant="strong"
                size="sm"
                glass={false}
                class="gap-1.5"
                onClick={() => {
                  changeOpen(false);
                  props.onCreate();
                }}
              >
                <Plus class="size-4" />
                Create agent
              </Button>
            </div>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
