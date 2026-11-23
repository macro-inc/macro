import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { catalogModelLabel } from '@core/component/AI/constant/model-label';
import Bolt from '@icon/system/fill/lightning-fill.svg';
import PinFill from '@icon/system/fill/push-pin-fill.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import Rocket from '@icon/system/regular/rocket.svg';
import { Show } from 'solid-js';
import { AgentAvatar } from '../../components/AgentGlyph';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { speedChoices, speedTier } from '../../core/model-selection';
import { MACRO_PERSONA_ID } from '../../core/roster';

export function UnifiedModelTriggerContent() {
  const state = useUnifiedModelSelector();
  const custom = () => state.agent && state.agent.id !== MACRO_PERSONA_ID;
  const model = () =>
    state.models.find((option) => option.id === state.model)?.label ??
    catalogModelLabel(state.model, state.models);
  const label = () => (custom() ? state.agent?.name : model());
  const showModel = () =>
    custom() &&
    state.model &&
    (state.showModelLabel || state.model !== state.agent?.defaultModel);
  const thinking = () => {
    const effort = state.effort;
    if (!effort || effort.options.length < 2) return;
    const value = state.effortValue ?? effort.currentValue;
    if (
      state.defaultEffortValue !== undefined &&
      value === state.defaultEffortValue
    )
      return;
    return effort.options.find((choice) => choice.value === value)?.name;
  };
  return (
    <>
      <span class="flex min-w-0 items-center gap-1">
        <Show
          when={custom()}
          fallback={<ModelIcon model={state.model} class="size-4 shrink-0" />}
        >
          <AgentAvatar
            agent={state.agent!}
            coder={false}
            class="size-4"
            iconClass="size-3.5"
          />
        </Show>
        <span class="min-w-0 truncate text-ink-muted">{label()}</span>
      </span>
      <Show when={showModel()}>
        <span class="shrink-0 text-ink-extra-muted">{model()}</span>
        <Show when={state.modelKept}>
          <PinFill class="size-3.5 shrink-0 text-ink-extra-muted" />
        </Show>
      </Show>
      <Show when={thinking()}>
        <span class="shrink-0 text-ink-extra-muted">{thinking()}</span>
      </Show>
      <Show
        when={
          speedTier(state.speedValue) !== 'standard' &&
          speedChoices(state.speeds ?? []).some(
            (choice) =>
              choice.value === state.speedValue && choice.tier !== 'standard'
          )
        }
      >
        <span class="flex shrink-0 items-center text-accent">
          <Show
            when={speedTier(state.speedValue) === 'ultrafast'}
            fallback={<Bolt class="size-3.5" />}
          >
            <Rocket class="size-3.5" />
          </Show>
        </span>
      </Show>
      <CaretDown class="size-3.5 shrink-0 text-ink-extra-muted" />
    </>
  );
}
