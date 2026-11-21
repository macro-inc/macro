import { t } from '@app/lib/i18n';
import { catalogModelLabel } from '@core/component/AI/constant/model-label';
import { Tooltip } from '@ui';
import type { JSX } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { speedTier } from '../../core/model-selection';
import { MACRO_PERSONA_ID } from '../../core/roster';

export function UnifiedModelTrigger(props: { children: JSX.Element }) {
  const state = useUnifiedModelSelector();
  const custom = () => state.agent && state.agent.id !== MACRO_PERSONA_ID;
  const name = () =>
    custom() ? state.agent?.name : catalogModelLabel(state.model, state.models);
  const effort = () =>
    state.effort?.options.length && state.effort.options.length > 1
      ? state.effort.options.find(
          (choice) =>
            choice.value === (state.effortValue ?? state.effort?.currentValue)
        )?.name
      : undefined;
  const tooltip = () =>
    [
      name(),
      effort() && `${effort()} effort`,
      state.speeds?.length && state.speeds.length > 1
        ? t(`agentControls.tier${speedTier(state.speedValue)}`)
        : undefined,
    ]
      .filter(Boolean)
      .join(', ');
  return (
    <Tooltip.Root>
      <Tooltip.Trigger as="span" class="min-w-0 max-w-full">
        {props.children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content>{tooltip()}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
