import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { modelLabel } from '@core/component/AI/constant/model-label';
import ArrowLeft from '@phosphor/arrow-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import Plus from '@phosphor/plus.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
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
  const groups = () =>
    agentPickerGroups(
      props.agents.filter((agent) =>
        matches(`${agent.name} ${agent.runtime.label}`)
      )
    );
  const searchLabel = () =>
    browsing()
      ? 'Search models'
      : macro()
        ? 'Search agents and models'
        : 'Search agents';
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
              {browsing()?.name ??
                (macro() ? 'Agents and models' : 'Choose an agent')}
            </h2>
          </div>
          <input
            aria-label={searchLabel()}
            placeholder={searchLabel()}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            class="mx-4 mb-3 rounded-xl border border-edge-muted bg-input px-3 py-2 text-base outline-none"
          />
          <MobileDrawer.ScrollBody class="gap-3 rounded-b-none pb-2">
            <Show when={browsing()}>
              {(agent) => (
                <MobileDrawer.Item onClick={() => choose(agent())}>
                  Use {agent().name} default
                </MobileDrawer.Item>
              )}
            </Show>
            <Show when={browsing() ?? macro()}>
              <div>
                <MobileDrawer.Label class="px-4 font-medium text-ink-muted">
                  Models
                </MobileDrawer.Label>
                <MobileDrawer.Section>
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
                  <Show when={models().length === 0}>
                    <p role="status" class="px-4 py-3 text-sm text-ink-muted">
                      {query() ? 'No matching models' : catalog.message()}
                    </p>
                  </Show>
                </MobileDrawer.Section>
              </div>
            </Show>
            <Show when={!browsing()}>
              <For each={groups()}>
                {(group) => (
                  <div>
                    <MobileDrawer.Label class="px-4 font-medium text-ink-muted">
                      {group.label}
                    </MobileDrawer.Label>
                    <MobileDrawer.Section role="group" aria-label={group.label}>
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
          </MobileDrawer.ScrollBody>
          <div class="flex shrink-0 justify-end border-t border-edge-muted px-4 pt-3 pb-[max(16px,var(--mobile-sheet-safe-padding))]">
            <MobileDrawer.Item
              class="w-auto gap-1.5 rounded-xl bg-ink/5 px-3 font-medium"
              onClick={() => {
                changeOpen(false);
                props.onCreate();
              }}
            >
              <Plus class="size-4" />
              Create agent
            </MobileDrawer.Item>
          </div>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
