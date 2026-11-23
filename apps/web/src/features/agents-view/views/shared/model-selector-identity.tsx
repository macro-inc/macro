import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { catalogModelLabel } from '@core/component/AI/constant/model-label';
import { Show } from 'solid-js';
import { AgentIcon } from '../../components/AgentGlyph';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { MACRO_PERSONA_ID } from '../../core/roster';

export function ModelSelectorIdentity(props: { mobile?: boolean }) {
  const state = useUnifiedModelSelector();
  const custom = () => state.agent && state.agent.id !== MACRO_PERSONA_ID;
  return (
    <>
      <Show
        when={custom()}
        fallback={
          <ModelIcon
            model={state.model}
            class={props.mobile ? 'size-[18px] shrink-0' : 'size-4 shrink-0'}
          />
        }
      >
        <span class="flex size-[18px] shrink-0 items-center justify-center rounded bg-ink/8">
          <AgentIcon agent={state.agent!} class="size-4" />
        </span>
      </Show>
      <span class="min-w-0 truncate">
        {custom()
          ? state.agent?.name
          : catalogModelLabel(state.model, state.models)}
      </span>
    </>
  );
}
