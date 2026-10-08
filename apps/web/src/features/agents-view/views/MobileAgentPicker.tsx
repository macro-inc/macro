import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { modelLabel } from '@core/component/AI/constant/model-label';
import ArrowLeft from '@phosphor/arrow-left.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import Plus from '@phosphor/plus.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { AgentIcon } from '../components/AgentGlyph';
import {
  MACRO_PERSONA_ID,
  type RosterAgent,
  rosterForAgentPicker,
} from '../core/roster';
import { createComposerModels } from '../queries/composer-models';
import type { AgentPickerProps } from './AgentPicker';

/** A single sheet drills into models without hover menus or offscreen submenus. */
export function MobileAgentPicker(props: AgentPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
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
  const models = () =>
    catalog
      .models()
      .filter((option) => matches(modelLabel(option.id, option.name)));
  const agents = () =>
    rosterForAgentPicker(props.agents).filter((agent) => matches(agent.name));
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setBrowsing(undefined);
    }
  };
  const choose = (agent: RosterAgent, model?: string) => {
    props.onSelect(agent, model);
    changeOpen(false);
  };
  const browse = (agent?: RosterAgent) => {
    setQuery('');
    setBrowsing(agent);
  };
  return (
    <MobileDrawer side="bottom" open={open()} onOpenChange={changeOpen}>
      <MobileDrawer.Trigger
        as={Button}
        variant="ghost"
        size="sm"
        aria-label="Agent"
        title={label()}
        class="h-[30px] min-w-0 max-w-full gap-1 rounded-full border border-edge-muted bg-ink/5 px-2 text-[12px] font-medium leading-none text-ink-muted"
      >
        <Show when={props.selected?.id !== MACRO_PERSONA_ID && props.selected}>
          {(agent) => (
            <AgentIcon agent={agent()} class="size-[12px] shrink-0" />
          )}
        </Show>
        <span class="truncate">{label()}</span>
        <CaretDown class="size-[10px] shrink-0" />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Choose an agent or model">
          <MobileDrawer.Handle />
          <div class="flex items-center gap-2 px-4 pb-3">
            <Show when={browsing()}>
              <Button
                variant="ghost"
                size="icon-md"
                label="Back to agents"
                onClick={() => browse()}
              >
                <ArrowLeft />
              </Button>
            </Show>
            <h2 class="min-w-0 flex-1 truncate font-medium">
              {browsing()?.name ?? 'Agents and models'}
            </h2>
          </div>
          <input
            ref={(element) => element.focus()}
            aria-label="Search agents and models"
            placeholder="Search"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            class="mx-4 mb-3 rounded-xl border border-edge-muted bg-input px-3 py-2 text-base outline-none"
          />
          <MobileDrawer.ScrollBody>
            <Show when={browsing()}>
              {(agent) => (
                <MobileDrawer.Item onClick={() => choose(agent())}>
                  Use {agent().name} default
                </MobileDrawer.Item>
              )}
            </Show>
            <MobileDrawer.Label>Models</MobileDrawer.Label>
            <For each={models()}>
              {(option) => (
                <MobileDrawer.Item
                  onClick={() => {
                    const agent = browsing() ?? macro();
                    if (agent) choose(agent, option.id);
                  }}
                >
                  <ModelIcon model={option.id} />
                  <span class="min-w-0 flex-1 truncate">
                    {modelLabel(option.id, option.name)}
                  </span>
                  <Show
                    when={
                      props.selected?.id === (browsing() ?? macro())?.id &&
                      model() === option.id
                    }
                  >
                    <Check class="size-4 text-accent" />
                  </Show>
                </MobileDrawer.Item>
              )}
            </For>
            <Show when={models().length === 0}>
              <p role="status" class="px-4 py-3 text-sm text-ink-muted">
                {query() ? 'No matching models' : catalog.message()}
              </p>
            </Show>
            <Show when={!browsing()}>
              <For each={['agent', 'coder'] as const}>
                {(kind) => (
                  <Show when={agents().some((agent) => agent.kind === kind)}>
                    <MobileDrawer.Label>
                      {kind === 'coder' ? 'Coding agents' : 'Agents'}
                    </MobileDrawer.Label>
                    <For each={agents().filter((agent) => agent.kind === kind)}>
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
                            <AgentIcon agent={agent} class="size-5 shrink-0" />
                            <span class="min-w-0 flex-1 text-left">
                              <span class="block truncate">{agent.name}</span>
                              <Show when={agent.unavailableReason}>
                                <span class="block text-xs text-ink-muted">
                                  {agent.connectLabel ??
                                    agent.unavailableReason}
                                </span>
                              </Show>
                            </span>
                            <Show when={props.selected?.id === agent.id}>
                              <Check class="size-4 text-accent" />
                            </Show>
                          </MobileDrawer.Item>
                          <Show when={!agent.unavailableReason}>
                            <Button
                              variant="ghost"
                              size="icon-md"
                              class="mr-3 size-11"
                              label={`Models for ${agent.name}`}
                              onClick={() => browse(agent)}
                            >
                              <CaretRight />
                            </Button>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                )}
              </For>
              <Show when={props.loading}>
                <p role="status" class="px-4 py-3 text-sm text-ink-muted">
                  Loading agents…
                </p>
              </Show>
            </Show>
          </MobileDrawer.ScrollBody>
          <MobileDrawer.Item
            class="shrink-0 border-t border-edge-muted"
            onClick={() => {
              changeOpen(false);
              props.onCreate();
            }}
          >
            <Plus class="size-5" />
            Create agent
          </MobileDrawer.Item>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
