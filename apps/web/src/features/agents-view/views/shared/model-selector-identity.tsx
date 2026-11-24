import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { catalogModelLabel } from '@core/component/AI/constant/model-label';
import { Show } from 'solid-js';
import { AgentAvatar } from '../../components/AgentGlyph';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { MACRO_PERSONA_ID } from '../../core/roster';

export function ModelSelectorIdentity() {
  const state = useUnifiedModelSelector();
  const custom = () => state.agent && state.agent.id !== MACRO_PERSONA_ID;
  return (
    <span class="flex min-w-0 items-center gap-2">
      <Show
        when={custom()}
        fallback={<ModelIcon model={state.model} class="size-4 shrink-0" />}
      >
        <AgentAvatar
          agent={state.agent!}
          coder={false}
          class="size-4"
          iconClass="size-4"
        />
      </Show>
      <span class="min-w-0 truncate">
        {custom()
          ? state.agent?.name
          : catalogModelLabel(state.model, state.models)}
      </span>
    </span>
  );
}
