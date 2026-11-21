import { modelLabel } from '@core/component/AI/constant/model-label';
import { createMemo } from 'solid-js';
import { MACRO_PERSONA_ID, type RosterAgent } from '../core/roster';
import { UnifiedModelSelector } from '../model-selector';
import { createComposerModels } from '../queries/composer-models';

/** Model-only hosts retain their draft/target ownership and omit effort and speed. */
export function AgentModelPicker(props: {
  agents: RosterAgent[];
  selected?: RosterAgent;
  modelOverride?: string;
  loading: boolean;
  onSelect: (agent: RosterAgent, model?: string) => void;
  onConnect: (agent: RosterAgent) => void;
  onCreate: () => void;
}) {
  const selectedCatalog = createComposerModels(() => props.selected);
  const macro = () =>
    props.agents.find((agent) => agent.id === MACRO_PERSONA_ID);
  const macroCatalog = createComposerModels(macro);
  const models = createMemo(() =>
    selectedCatalog.models().map((option) => ({
      id: option.id,
      label: modelLabel(option.id, option.name, option.description),
      group: option.group ?? undefined,
    }))
  );
  const suggestedModels = createMemo(() =>
    (macro() ? macroCatalog.models() : selectedCatalog.models()).map(
      (option) => ({
        id: option.id,
        label: modelLabel(option.id, option.name, option.description),
        group: option.group ?? undefined,
      })
    )
  );

  return (
    <UnifiedModelSelector
      state={{
        agent: props.selected,
        showModelLabel: true,
        agents: props.agents.filter((agent) => agent.id !== MACRO_PERSONA_ID),
        model:
          props.modelOverride ??
          props.selected?.defaultModel ??
          selectedCatalog.currentModel(),
        models: models(),
        suggestedModels: suggestedModels(),
        suggestedSelected: !macro() || props.selected?.id === MACRO_PERSONA_ID,
        suggestedDisabled: Boolean(
          (macro() ?? props.selected)?.unavailableReason
        ),
        loading: props.loading,
        onModel: (model) => {
          if (props.selected) props.onSelect(props.selected, model);
        },
        onSuggestedModel: (model) => {
          const agent = macro() ?? props.selected;
          if (agent && !agent.unavailableReason) props.onSelect(agent, model);
        },
        onAgent: (agent) => props.onSelect(agent),
        onConnect: props.onConnect,
        onCreate: props.onCreate,
        onEffort: () => {},
        onSpeed: () => {},
      }}
    />
  );
}
