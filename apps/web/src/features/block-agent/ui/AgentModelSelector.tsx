/**
 * The session's model, as a pill that opens the harness's own model list.
 *
 * Everything here is harness-reported: the options come from the runtime's
 * ACP `configOptions` and the current model is the fold's rejection-safe
 * projection of them, so this component never needs a model registry of its
 * own. Renders nothing until the harness has advertised its models.
 */

import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import type { ModelOption } from '@service-agent-fold/generated/types';
import { cn, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';

export interface AgentModelSelectorProps {
  /** Current model id, when the fold has learned it. */
  model: string | null;
  /**
   * A change to this model is on the wire. The pill shows it, shimmering,
   * so the switch is visibly in progress rather than appearing not to have
   * registered — the request can block for a whole container resume.
   */
  changingTo?: string;
  /** The models the harness offers, in the order it listed them. */
  options: ModelOption[];
  disabled?: boolean;
  /** Receives the id of the model to switch to. */
  onSelect: (model: string) => void;
}

export function AgentModelSelector(props: AgentModelSelectorProps) {
  const shown = () => props.changingTo ?? props.model;
  const label = () =>
    props.options.find((option) => option.id === shown())?.name ??
    shown() ??
    'Model';

  return (
    <Show when={props.options.length > 0}>
      <Dropdown placement="top-start">
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          class="h-6 gap-1 rounded-full bg-ink/5 px-2 text-xs text-ink-muted hover:bg-ink/10"
          disabled={props.disabled || props.changingTo !== undefined}
        >
          <TextShimmer text={label()} active={props.changingTo !== undefined} />
          <CaretDown />
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Group>
            <For each={props.options}>
              {(option) => (
                <Dropdown.Item
                  class={cn(
                    'gap-2',
                    option.id === shown() && 'text-ink font-medium'
                  )}
                  title={option.description ?? undefined}
                  onSelect={() => {
                    if (option.id !== props.model) props.onSelect(option.id);
                  }}
                >
                  <span class="flex-1 truncate text-xs">{option.name}</span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
