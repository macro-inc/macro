/**
 * The session's model, as a pill that opens the harness's own model list.
 *
 * The catalog is harness-reported: the options come from the runtime's ACP
 * `configOptions` and the current model is the fold's rejection-safe
 * projection of them. Names and logos still go through the house
 * `modelLabel` / `ModelIcon`, because a runtime that keeps no display name
 * for a model — the in-memory Macro Agent among them — reports the slug as
 * its name. Renders nothing on desktop until the harness has advertised its
 * models. The list itself is the shared `ModelCatalogPicker`.
 */

import {
  ModelCatalogPicker,
  type ModelRowProps,
} from '@core/component/AI/component/input/ModelCatalogPicker';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ModelOption } from '@service-agent-fold/generated/types';
import { type Component, createMemo, Show } from 'solid-js';
import { withoutRedundantGroups } from './model-groups';

export interface AgentModelSelectorProps {
  /** Current model id, when the fold has learned it. */
  model: string | null;
  /**
   * A change to this model the fold has shown but `metadata.model` has not
   * caught up to. The pill reads it as the current model at once and stays
   * interactive; a runtime rejection later reverts it through the fold.
   */
  changingTo?: string;
  /** The models the harness offers, in the order it listed them. */
  options: ModelOption[];
  disabled?: boolean;
  effortLabel?: string;
  modelRow?: Component<ModelRowProps>;
  /** Receives the id of the model to switch to. */
  onSelect: (model: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function AgentModelSelector(props: AgentModelSelectorProps) {
  const shown = () => props.changingTo ?? props.model;
  const label = () =>
    [
      modelLabel(
        shown() ?? undefined,
        props.options.find((option) => option.id === shown())?.name
      ),
      isTouchDevice() ? props.effortLabel : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  const options = createMemo(() =>
    withoutRedundantGroups(props.options).map((option) => ({
      id: option.id,
      label: modelLabel(option.id, option.name),
      description: option.description ?? undefined,
      group: option.group ?? undefined,
    }))
  );

  return (
    <Show when={isTouchDevice() || props.options.length > 0}>
      <ModelCatalogPicker
        value={shown()}
        options={options()}
        onSelect={(id) => {
          if (id !== props.model) props.onSelect(id);
        }}
        onCloseAutoFocus={props.onCloseAutoFocus}
        modelRow={props.modelRow}
        triggerLabel={label()}
        disabled={props.disabled}
        pending={isTouchDevice() && props.changingTo !== undefined}
        ariaLabel="Agent model"
        emptyMessage="Waiting for the agent to report its models."
        triggerClass="w-auto max-w-[9rem] min-w-0 justify-start gap-1 rounded-full border-transparent bg-ink/5 px-2 text-left text-sm text-ink-subtle hover:bg-ink/10 touch:max-w-[60vw] touch:gap-1.5 touch:rounded-lg touch:bg-transparent touch:px-1.5 touch:hover:bg-hover"
        triggerSize="md"
        contentClass="overflow-hidden"
        placement="top-start"
      />
    </Show>
  );
}
