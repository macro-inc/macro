import CaretRight from '@icon/system/regular/caret-right.svg';
import { Button, Menu } from '@ui';
import { Show } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { ThinkingSlider } from '../../components/unified-model-selector/thinking-slider';
import { speedChoices } from '../../core/model-selection';
import { MACRO_PERSONA_ID } from '../../core/roster';
import { ModelSelectorIdentity } from './model-selector-identity';
import { ModelSelectorModelRow } from './model-selector-model-row';
import { SpeedButton } from './speed-button';

export function ModelSelectorCard(props: {
  onSelect: () => void;
  onModels: () => void;
}) {
  const state = useUnifiedModelSelector();
  const custom = () => state.agent && state.agent.id !== MACRO_PERSONA_ID;
  const controls = () => state.model?.toLowerCase() !== 'auto';
  const thinking = () =>
    controls() && (!custom() || (state.effort?.options.length ?? 0) > 1);
  const speed = () => controls() && speedChoices(state.speeds ?? []).length > 1;
  return (
    <Menu.Group class="gap-2">
      <div class="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="xs"
          disabled={state.disabled}
          onClick={props.onSelect}
          class="min-w-0"
        >
          <ModelSelectorIdentity />
          <CaretRight class="size-4 shrink-0" />
        </Button>
        <Show when={speed()}>
          <SpeedButton />
        </Show>
      </div>
      <Show when={(custom() && state.model) || thinking()}>
        <div class="flex flex-col gap-2">
          <Show when={custom() && state.model}>
            <ModelSelectorModelRow onModels={props.onModels} />
          </Show>
          <Show when={thinking()}>
            <ThinkingSlider
              effort={state.effort}
              value={state.effortValue}
              disabled={state.effortDisabled || state.disabled}
              onCommit={state.onEffort}
            />
          </Show>
        </div>
      </Show>
    </Menu.Group>
  );
}
