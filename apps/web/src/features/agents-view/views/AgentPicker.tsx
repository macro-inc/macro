import { ModelCatalogMenu } from '@core/component/AI/component/input/ModelCatalogPicker';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import { buttonClasses, cn, Dropdown } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, For, Show } from 'solid-js';
import { AgentModelMenuItem } from '../../block-agent/component/AgentModelMenuItem';
import type {
  EffortChoice,
  EffortSelection,
} from '../../block-agent/state/session-config';
import { AgentIcon } from '../components/AgentGlyph';
import { AgentPickerIdentity } from '../components/AgentPickerIdentity';
import { agentPickerGroups } from '../core/agent-picker-groups';
import { MACRO_PERSONA_ID, type RosterAgent } from '../core/roster';
import { createComposerModels } from '../queries/composer-models';
import { AGENTS_TOUR } from '../tour';
import { MobileAgentPicker } from './MobileAgentPicker';

/** Agent selection with a per-message model catalog in each submenu. */
export type AgentPickerProps = {
  agents: RosterAgent[];
  selected?: RosterAgent;
  modelOverride?: string;
  loading: boolean;
  triggerClass?: string;
  effortLabel?: string;
  effortSelection?: EffortSelection;
  onSelect: (agent: RosterAgent, model?: string) => void;
  /** Supply only when the host can persist and apply effort selections. */
  onSelectEffort?: (
    agent: RosterAgent,
    model: string,
    effort: EffortChoice
  ) => void;
  onConnect: (agent: RosterAgent) => void;
  onCreate: () => void;
};

export function AgentPicker(props: AgentPickerProps) {
  return (
    <Show when={isTouchDevice()} fallback={<DesktopAgentPicker {...props} />}>
      <MobileAgentPicker {...props} />
    </Show>
  );
}

function DesktopAgentPicker(props: AgentPickerProps) {
  const [open, setOpen] = createSignal(false);
  const catalog = createComposerModels(() => props.selected);
  const macro = () =>
    props.agents.find((agent) => agent.id === MACRO_PERSONA_ID);
  const macroCatalog = createComposerModels(macro);
  const groups = () => agentPickerGroups(props.agents);
  const rawModel = () => props.selected?.id === MACRO_PERSONA_ID;
  const model = () =>
    props.modelOverride ??
    props.selected?.defaultModel ??
    catalog.currentModel();
  const baseLabel = () =>
    modelLabel(
      model(),
      catalog.models().find((option) => option.id === model())?.name
    );
  const label = () =>
    [baseLabel(), props.effortLabel].filter(Boolean).join(' · ');
  const choose = (agent: RosterAgent, model?: string) => {
    props.onSelect(agent, model);
    setOpen(false);
  };
  const chooseEffort = (
    agent: RosterAgent,
    model: string,
    effort: EffortChoice
  ) => {
    props.onSelectEffort?.(agent, model, effort);
    setOpen(false);
  };
  return (
    <Dropdown open={open()} onOpenChange={setOpen} placement="top-end">
      <Dropdown.Trigger
        variant="ghost"
        aria-label="Agent"
        ref={tourTarget(AGENTS_TOUR.picker)}
        title={
          rawModel()
            ? label()
            : `${props.selected?.name ?? 'Choose agent'} · ${label()}`
        }
        class={cn(
          'h-[33.75px] min-w-0 max-w-full gap-[5.625px] px-[7.5px] text-base font-normal text-ink-muted light-mode:text-composer-placeholder',
          props.triggerClass
        )}
      >
        <Show when={!rawModel()}>
          <Show
            when={props.selected}
            fallback={
              <span class="min-w-0 truncate text-left leading-5">
                Choose agent
              </span>
            }
          >
            {(agent) => (
              <>
                <AgentIcon agent={agent()} class="size-[15px] shrink-0" />
                <span class="min-w-0 truncate text-left leading-5">
                  {agent().name}
                </span>
              </>
            )}
          </Show>
        </Show>
        {/* The model shows as its provider's logo; the title spells it out. */}
        <Show when={rawModel()}>
          <ModelIcon model={model()} class="size-[15px] shrink-0" />
        </Show>
        <CaretDownIcon class="size-[15px] shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Content
        class="w-88 max-w-[calc(100vw-1rem)] overflow-hidden"
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
      >
        <div class="flex min-h-0 max-h-[min(28rem,var(--kb-popper-content-available-height))] flex-col">
          <div class="min-h-0 space-y-2 overflow-y-auto overscroll-contain p-2">
            <Show when={macro()}>
              {(agent) => (
                <ModelCatalogMenu
                  autoFocusSearch
                  value={
                    props.selected?.id === agent().id ? (model() ?? null) : null
                  }
                  disabled={Boolean(agent().unavailableReason)}
                  options={macroCatalog.models().map((option) => ({
                    id: option.id,
                    label: modelLabel(option.id, option.name),
                    description: option.description ?? undefined,
                    group: option.group ?? undefined,
                  }))}
                  onSelect={(id) => choose(agent(), id)}
                  modelRow={
                    props.onSelectEffort
                      ? (row) => (
                          <AgentModelMenuItem
                            {...row}
                            harness={agent().harness}
                            effortValue={
                              row.selected
                                ? props.effortSelection?.value
                                : undefined
                            }
                            onSelectEffort={(effort) =>
                              chooseEffort(agent(), row.option.id, effort)
                            }
                          />
                        )
                      : undefined
                  }
                  emptyMessage={macroCatalog.message()}
                />
              )}
            </Show>
            <For each={groups()}>
              {(group) => (
                <Dropdown.Group class="bg-transparent">
                  <Dropdown.GroupLabel class="font-medium text-ink-muted">
                    {group.label}
                  </Dropdown.GroupLabel>
                  <For each={group.agents}>
                    {(agent) => (
                      <AgentPickerRow
                        agent={agent}
                        selected={agent.id === props.selected?.id}
                        modelOverride={
                          agent.id === props.selected?.id
                            ? props.modelOverride
                            : undefined
                        }
                        effortSelection={
                          agent.id === props.selected?.id
                            ? props.effortSelection
                            : undefined
                        }
                        onSelect={(model) => choose(agent, model)}
                        onSelectEffort={
                          props.onSelectEffort
                            ? (model, effort) =>
                                chooseEffort(agent, model, effort)
                            : undefined
                        }
                        onConnect={() => {
                          setOpen(false);
                          props.onConnect(agent);
                        }}
                      />
                    )}
                  </For>
                </Dropdown.Group>
              )}
            </For>
            <Show when={!props.loading && !macro() && groups().length === 0}>
              <p role="status" class="px-3 py-2 text-sm text-ink-muted">
                No agents available
              </p>
            </Show>
            <Show when={props.loading}>
              <div
                role="status"
                class="bg-menu px-3 py-2 text-xs text-ink-muted"
              >
                Loading agents…
              </div>
            </Show>
            <Dropdown.Group class="items-end bg-transparent px-1.5 pt-1 pb-0">
              <Dropdown.Item
                closeOnSelect
                class={buttonClasses({
                  variant: 'strong',
                  size: 'sm',
                  glass: false,
                  class: 'w-auto gap-1.5 data-highlighted:overlay-hover',
                })}
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
        </div>
      </Dropdown.Content>
    </Dropdown>
  );
}

function AgentPickerRow(props: {
  agent: RosterAgent;
  selected: boolean;
  modelOverride?: string;
  effortSelection?: EffortSelection;
  onSelect: (model?: string) => void;
  onSelectEffort?: (model: string, effort: EffortChoice) => void;
  onConnect: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const identity = () => (
    <AgentPickerIdentity
      agent={props.agent}
      selected={props.selected}
      model={props.modelOverride}
    />
  );
  return (
    <div class="flex min-w-0 items-center gap-1">
      <Show
        when={!props.agent.unavailableReason}
        fallback={
          <Dropdown.Item
            closeOnSelect
            class="min-w-0 flex-1 gap-3 py-2"
            disabled={!props.agent.connectLabel}
            title={props.agent.unavailableReason}
            onSelect={props.onConnect}
          >
            {identity()}
          </Dropdown.Item>
        }
      >
        <Dropdown.Sub open={open()} onOpenChange={setOpen} overlap>
          <Dropdown.SubTrigger
            class="min-w-0 flex-1 gap-3 py-2"
            textValue={props.agent.name}
            onClick={() => {
              if (!isTouchDevice()) props.onSelect();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              props.onSelect();
            }}
          >
            {identity()}
            <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
          </Dropdown.SubTrigger>
          <Dropdown.SubContent
            aria-label={`Models for ${props.agent.name}`}
            class="w-72 max-w-[calc(100vw-1rem)] max-h-[min(28rem,var(--kb-popper-content-available-height))] overflow-y-auto overscroll-contain"
            onOpenAutoFocus={(event: Event) => event.preventDefault()}
            onPointerDown={(event: PointerEvent) => event.stopPropagation()}
            onMouseDown={(event: MouseEvent) => event.stopPropagation()}
          >
            <Show when={open()}>
              <AgentModels
                agent={props.agent}
                modelOverride={props.modelOverride}
                effortSelection={props.effortSelection}
                onSelect={props.onSelect}
                onSelectEffort={props.onSelectEffort}
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
  effortSelection?: EffortSelection;
  onSelect: (model?: string) => void;
  onSelectEffort?: (model: string, effort: EffortChoice) => void;
}) {
  const catalog = createComposerModels(() => props.agent);
  const defaultModel = () => props.agent.defaultModel ?? catalog.currentModel();
  return (
    <ModelCatalogMenu
      autoFocusSearch
      value={props.modelOverride ?? defaultModel() ?? null}
      options={catalog.models().map((option) => ({
        id: option.id,
        label: modelLabel(option.id, option.name),
        description: option.description ?? undefined,
        group: option.group ?? undefined,
      }))}
      onSelect={props.onSelect}
      modelRow={
        props.onSelectEffort
          ? (row) => (
              <AgentModelMenuItem
                {...row}
                harness={props.agent.harness}
                effortValue={
                  row.selected ? props.effortSelection?.value : undefined
                }
                onSelectEffort={(effort) =>
                  props.onSelectEffort?.(row.option.id, effort)
                }
              />
            )
          : undefined
      }
      emptyMessage={catalog.message()}
    />
  );
}
