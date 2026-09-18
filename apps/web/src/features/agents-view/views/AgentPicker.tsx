import { ModelCatalogMenu } from '@core/component/AI/component/input/ModelCatalogPicker';
import {
  modelProvider,
  ProviderIcon,
} from '@core/component/AI/component/ProviderIcon';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import CodeIcon from '@phosphor/code.svg';
import PlusIcon from '@phosphor/plus.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { AgentIcon } from '../components/AgentGlyph';
import { modelLabel } from '../components/model-label';
import {
  MACRO_PERSONA_ID,
  type RosterAgent,
  rosterForAgentPicker,
} from '../core/roster';
import { createComposerModels } from '../queries/composer-models';

/** Agent selection with a per-message model catalog in each submenu. */
export function AgentPicker(props: {
  agents: RosterAgent[];
  selected?: RosterAgent;
  modelOverride?: string;
  loading: boolean;
  onSelect: (agent: RosterAgent, model?: string) => void;
  onConnect: (agent: RosterAgent) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const catalog = createComposerModels(() => props.selected);
  const macro = () =>
    props.agents.find((agent) => agent.id === MACRO_PERSONA_ID);
  const macroCatalog = createComposerModels(macro);
  const agents = () => rosterForAgentPicker(props.agents);
  const rawModel = () => props.selected?.id === MACRO_PERSONA_ID;
  const model = () =>
    props.modelOverride ??
    props.selected?.defaultModel ??
    catalog.currentModel();
  const label = () =>
    modelLabel(
      model(),
      catalog.models().find((option) => option.id === model())?.name
    );
  const choose = (agent: RosterAgent, model?: string) => {
    props.onSelect(agent, model);
    setOpen(false);
  };
  return (
    <Dropdown open={open()} onOpenChange={setOpen} placement="top-end">
      <Dropdown.Trigger
        variant="ghost"
        aria-label="Agent"
        title={
          rawModel()
            ? label()
            : `${props.selected?.name ?? 'Choose agent'} · ${label()}`
        }
        class="h-[33.75px] min-w-0 max-w-full gap-[5.625px] rounded-full bg-transparent hover:bg-hover px-[7.5px] text-base font-normal text-ink-muted light-mode:text-composer-placeholder"
      >
        <Show
          when={rawModel()}
          fallback={
            <Show when={props.selected}>
              {(agent) => (
                <AgentIcon agent={agent()} class="size-[15px] shrink-0" />
              )}
            </Show>
          }
        >
          <ProviderIcon model={model()} class="size-[15px]" />
        </Show>
        <span class="min-w-0 truncate text-left leading-5">
          <Show
            when={rawModel()}
            fallback={
              <>
                {props.selected?.name ?? 'Choose agent'}
                <span> · {label()}</span>
              </>
            }
          >
            {label()}
          </Show>
        </span>
        <CaretDownIcon class="size-[15px] shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Content
        class="w-80 max-w-[calc(100vw-1rem)] overflow-hidden"
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
      >
        <div class="flex min-h-0 max-h-[min(28rem,var(--kb-popper-content-available-height))] flex-col">
          <div class="min-h-0 overflow-y-auto overscroll-contain">
            <For each={['coder', 'agent'] as const}>
              {(kind) => (
                <Show when={agents().some((agent) => agent.kind === kind)}>
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>
                      {kind === 'coder' ? 'Coding agents' : 'Agents'}
                    </Dropdown.GroupLabel>
                    <For each={agents().filter((agent) => agent.kind === kind)}>
                      {(agent) => (
                        <AgentPickerRow
                          agent={agent}
                          selected={agent.id === props.selected?.id}
                          modelOverride={
                            agent.id === props.selected?.id
                              ? props.modelOverride
                              : undefined
                          }
                          onSelect={(model) => choose(agent, model)}
                          onConnect={() => {
                            setOpen(false);
                            props.onConnect(agent);
                          }}
                        />
                      )}
                    </For>
                  </Dropdown.Group>
                </Show>
              )}
            </For>
            <Show when={macro()}>
              {(agent) => (
                <Dropdown.Group>
                  <Dropdown.GroupLabel>Models</Dropdown.GroupLabel>
                  <For each={macroCatalog.models()}>
                    {(option) => (
                      <Dropdown.Item
                        closeOnSelect
                        class="min-w-0 gap-2"
                        disabled={Boolean(agent().unavailableReason)}
                        textValue={modelLabel(option.id, option.name)}
                        title={modelLabel(option.id, option.name)}
                        onSelect={() => choose(agent(), option.id)}
                      >
                        <span class="flex size-5 shrink-0 items-center justify-center">
                          <Show
                            when={modelProvider(option.id)}
                            fallback={<SparkleIcon class="size-4 shrink-0" />}
                          >
                            <ProviderIcon model={option.id} class="size-4" />
                          </Show>
                        </span>
                        <span class="min-w-0 flex-1 truncate">
                          {modelLabel(option.id, option.name)}
                        </span>
                        <Show
                          when={
                            props.selected?.id === agent().id &&
                            model() === option.id
                          }
                        >
                          <CheckIcon class="size-3.5 shrink-0 text-accent" />
                        </Show>
                      </Dropdown.Item>
                    )}
                  </For>
                  <Show when={macroCatalog.models().length === 0}>
                    <div role="status" class="px-3 py-2 text-xs text-ink-muted">
                      {macroCatalog.message()}
                    </div>
                  </Show>
                </Dropdown.Group>
              )}
            </Show>
            <Show when={props.loading}>
              <div
                role="status"
                class="bg-menu px-3 py-2 text-xs text-ink-muted"
              >
                Loading agents…
              </div>
            </Show>
          </div>
          <Dropdown.Group class="shrink-0 border-t border-edge-muted">
            <Dropdown.Item
              closeOnSelect
              onSelect={() => {
                setOpen(false);
                props.onCreate();
              }}
            >
              <PlusIcon class="size-4" />
              Create agent
            </Dropdown.Item>
          </Dropdown.Group>
        </div>
      </Dropdown.Content>
    </Dropdown>
  );
}

function AgentPickerRow(props: {
  agent: RosterAgent;
  selected: boolean;
  modelOverride?: string;
  onSelect: (model?: string) => void;
  onConnect: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const identity = () => (
    <>
      <AgentIcon agent={props.agent} class="size-5 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{props.agent.name}</span>
      <Show when={props.agent.kind === 'coder'}>
        <CodeIcon
          class="size-3.5 shrink-0 text-ink-muted"
          aria-label="Coding agent"
        />
      </Show>
      <Show when={props.selected}>
        <CheckIcon class="size-3.5 shrink-0 text-accent" />
      </Show>
    </>
  );
  return (
    <div class="flex min-w-0 items-center gap-1">
      <Show
        when={!props.agent.unavailableReason}
        fallback={
          <Dropdown.Item
            closeOnSelect
            class="min-w-0 flex-1"
            disabled={!props.agent.connectLabel}
            title={props.agent.unavailableReason}
            onSelect={props.onConnect}
          >
            {identity()}
            <span class="text-xs text-ink-muted">
              {props.agent.connectLabel ?? props.agent.unavailableReason}
            </span>
          </Dropdown.Item>
        }
      >
        <Dropdown.Sub open={open()} onOpenChange={setOpen}>
          <Dropdown.SubTrigger
            class="min-w-0 flex-1 gap-2"
            textValue={props.agent.name}
            onClick={() => props.onSelect()}
          >
            {identity()}
            <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
          </Dropdown.SubTrigger>
          <Dropdown.SubContent
            aria-label={`Models for ${props.agent.name}`}
            class="w-72 max-w-[calc(100vw-1rem)] max-h-[min(28rem,var(--kb-popper-content-available-height))] overflow-y-auto overscroll-contain"
            onPointerDown={(event: PointerEvent) => event.stopPropagation()}
            onMouseDown={(event: MouseEvent) => event.stopPropagation()}
          >
            <Show when={open()}>
              <AgentModels
                agent={props.agent}
                modelOverride={props.modelOverride}
                onSelect={props.onSelect}
              />
            </Show>
          </Dropdown.SubContent>
        </Dropdown.Sub>
      </Show>
    </div>
  );
}

function AgentModels(props: {
  agent: RosterAgent;
  modelOverride?: string;
  onSelect: (model?: string) => void;
}) {
  const catalog = createComposerModels(() => props.agent);
  const defaultModel = () => props.agent.defaultModel ?? catalog.currentModel();
  return (
    <ModelCatalogMenu
      value={props.modelOverride ?? defaultModel() ?? null}
      options={catalog.models().map((option) => ({
        id: option.id,
        label: modelLabel(option.id, option.name),
        description: option.description ?? undefined,
        group: option.group ?? undefined,
      }))}
      onSelect={props.onSelect}
      emptyMessage={catalog.message()}
    />
  );
}
