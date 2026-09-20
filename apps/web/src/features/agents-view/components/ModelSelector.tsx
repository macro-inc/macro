import type { AgentModelSelectorProps } from '@app/features/block-agent/ui/AgentModelSelector';
import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import type { JSX } from 'solid-js';
import { modelLabel } from './model-label';

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
  pending?: boolean;
  onSelect: (id: string) => void;
  children?: JSX.Element;
  emptyMessage?: string;
}) {
  return (
    <ModelCatalogPicker
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
      ariaLabel="Model"
      placement="top-end"
      disabled={props.disabled}
      pending={props.pending}
      onSelect={props.onSelect}
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
    <ModelSelector
      model={shown()}
      label={modelLabel(
        shown(),
        props.options.find((option) => option.id === shown())?.name
      )}
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
  );
}
