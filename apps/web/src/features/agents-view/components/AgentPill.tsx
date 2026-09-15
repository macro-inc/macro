import { PILL_CLASS } from '@app/features/block-agent/component/ModelPicker';
import MacroLogo from '@icon/macro-logo.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import { Avatar, cn, Dropdown } from '@ui';
import { For, Show } from 'solid-js';

export type AgentPillOption = {
  id: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  system: boolean;
  unavailableReason?: string;
};

function AgentGlyph(props: { agent: AgentPillOption; class?: string }) {
  return (
    <Avatar
      size="sm"
      class={cn(
        'shrink-0 bg-surface-2 text-accent ring ring-edge-muted',
        props.class
      )}
    >
      <Show
        when={props.agent.avatarUrl}
        fallback={
          <Avatar.Fallback>
            <Show
              when={props.agent.system}
              fallback={<RobotIcon class="size-2.5" />}
            >
              <MacroLogo class="size-2.5" />
            </Show>
          </Avatar.Fallback>
        }
      >
        {(url) => <Avatar.Image src={url()} alt="" />}
      </Show>
    </Avatar>
  );
}

/**
 * Which chat agent the composer addresses. Macro leads; saved chat agents
 * follow; the foot of the menu opens the roster to make another.
 */
export function AgentPill(props: {
  agents: AgentPillOption[];
  selectedId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const selected = () =>
    props.agents.find((agent) => agent.id === props.selectedId) ??
    props.agents[0];
  const saved = () => props.agents.filter((agent) => !agent.system);

  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="outline"
        size="sm"
        class={PILL_CLASS}
        aria-label="Agent"
        disabled={props.disabled}
        tooltip="Agent"
      >
        <Show when={selected()}>
          {(agent) => (
            <>
              <AgentGlyph agent={agent()} />
              <span class="min-w-0 truncate text-ink">{agent().name}</span>
            </>
          )}
        </Show>
        <CaretDownIcon class="size-3 shrink-0 text-current/70" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-72 max-w-[min(24rem,calc(100vw-1rem))]">
        <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
          <Dropdown.GroupLabel>Agent</Dropdown.GroupLabel>
          <For each={props.agents.filter((agent) => agent.system)}>
            {(agent) => (
              <AgentRow
                agent={agent}
                selected={agent.id === selected()?.id}
                onSelect={() => props.onSelect(agent.id)}
              />
            )}
          </For>
          <Show when={saved().length > 0}>
            <Dropdown.GroupLabel>Your agents</Dropdown.GroupLabel>
            <For each={saved()}>
              {(agent) => (
                <AgentRow
                  agent={agent}
                  selected={agent.id === selected()?.id}
                  onSelect={() => props.onSelect(agent.id)}
                />
              )}
            </For>
          </Show>
        </Dropdown.Group>
        <Dropdown.Separator class="my-1 h-px bg-edge-muted" />
        <Dropdown.Item class="h-8 gap-2" onSelect={props.onCreate}>
          <PlusIcon class="size-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate text-sm">Create agent</span>
          <span class="shrink-0 text-xs text-ink-extra-muted">
            {props.agents.length}{' '}
            {props.agents.length === 1 ? 'agent' : 'agents'}
          </span>
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}

function AgentRow(props: {
  agent: AgentPillOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Dropdown.Item
      class={cn(
        'h-8 gap-2',
        props.selected && 'bg-ink/5 font-medium text-ink',
        props.agent.unavailableReason && 'opacity-60'
      )}
      disabled={!!props.agent.unavailableReason}
      onSelect={props.onSelect}
    >
      <AgentGlyph agent={props.agent} />
      <span class="min-w-0 flex-1 truncate text-sm">{props.agent.name}</span>
      <span class="shrink-0 text-xs text-ink-extra-muted">
        @{props.agent.handle}
      </span>
      <Show when={props.selected}>
        <CheckIcon class="size-3.5 shrink-0 text-accent" />
      </Show>
    </Dropdown.Item>
  );
}
