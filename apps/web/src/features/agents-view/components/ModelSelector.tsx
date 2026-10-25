import {
  AgentModelSelector,
  type AgentModelSelectorProps,
} from '@app/features/block-agent/ui/AgentModelSelector';
import {
  ModelCatalogPicker,
  type ModelRowProps,
} from '@core/component/AI/component/input/ModelCatalogPicker';
import { modelLabel } from '@core/component/AI/constant/model-label';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { composerMenuAnchorRect } from '@core/util/composerMenuAnchor';
import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';

export type ModelChoice = {
  id: string;
  name: string;
  description?: string;
  group?: string;
};

/** The settings catalog with a compact trigger for new and running sessions. */
export function ModelSelector(props: {
  model?: string;
  label: JSX.Element;
  options: ModelChoice[];
  disabled?: boolean;
  modelRow?: Component<ModelRowProps>;
  pending?: boolean;
  onSelect: (id: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  children?: JSX.Element;
  emptyMessage?: string;
}) {
  return (
    <ModelCatalogPicker
      onCloseAutoFocus={props.onCloseAutoFocus}
      value={props.model ?? null}
      options={props.options.map((option) => ({
        id: option.id,
        label: modelLabel(option.id, option.name),
        description: option.description,
        group: option.group,
      }))}
      triggerLabel={props.label}
      placeholder={modelLabel(props.model)}
      triggerClass="h-[33.75px] min-w-0 max-w-full gap-[5.625px] rounded-full border-0 bg-transparent hover:bg-hover px-[7.5px] text-base font-normal text-ink-muted light-mode:text-composer-placeholder [&_svg]:size-[15px]"
      contentClass="w-[min(42rem,calc(100vw-2rem))] rounded-2xl border-0"
      ariaLabel="Model"
      placement="bottom-start"
      getAnchorRect={composerMenuAnchorRect}
      gutter={8}
      disabled={props.disabled}
      pending={props.pending}
      onSelect={props.onSelect}
      modelRow={props.modelRow}
      emptyMessage={
        props.emptyMessage ?? 'Waiting for the agent to report its models.'
      }
    >
      {props.children}
    </ModelCatalogPicker>
  );
}

/** Use the session's advertised catalog and existing model-change action. */
export function SessionModelSelector(props: AgentModelSelectorProps) {
  const shown = () => props.changingTo ?? props.model ?? undefined;
  return (
    <Show when={!isTouchDevice()} fallback={<AgentModelSelector {...props} />}>
      <ModelSelector
        onCloseAutoFocus={props.onCloseAutoFocus}
        model={shown()}
        label={modelLabel(
          shown(),
          props.options.find((option) => option.id === shown())?.name
        )}
        modelRow={props.modelRow}
        options={props.options.map((option) => ({
          id: option.id,
          name: option.name,
          group: option.group ?? undefined,
          description: option.description ?? undefined,
        }))}
        disabled={props.disabled}
        pending={props.changingTo !== undefined}
        onSelect={(id) => {
          if (id !== props.model) props.onSelect(id);
        }}
      />
    </Show>
  );
}
