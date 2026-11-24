import CaretRight from '@icon/system/regular/caret-right.svg';
import { Button } from '@ui';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { ThinkingSlider } from '../../components/unified-model-selector/thinking-slider';
import { speedChoices } from '../../core/model-selection';
import { MACRO_PERSONA_ID } from '../../core/roster';
import { ModelSelectorIdentity } from './model-selector-identity';
import { ModelSelectorModelRow } from './model-selector-model-row';
import { SpeedButton } from './speed-button';

export function ModelSelectorCard(props: {
  mobile?: boolean;
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
    <div
      class="flex flex-col gap-2"
      classList={{ 'p-2': !props.mobile, 'p-3': Boolean(props.mobile) }}
    >
      <div
        class="flex items-center justify-between gap-2"
        classList={{ 'h-7': !props.mobile, 'h-11': Boolean(props.mobile) }}
      >
        <Button
          variant="ghost"
          appearance="bare"
          onClick={props.onSelect}
          class={cn(
            'min-w-0 rounded-full not-touch:hover:bg-hover active:bg-active text-ink font-medium',
            props.mobile
              ? 'h-11 min-h-11 pl-2.5 pr-3 gap-2.5 text-base leading-[22px]'
              : 'h-7 min-h-7 pl-1.5 pr-2.5 gap-2 text-sm'
          )}
        >
          <ModelSelectorIdentity mobile={props.mobile} />
          <CaretRight
            class={
              props.mobile
                ? 'size-4 shrink-0 text-ink-extra-muted'
                : 'size-3.5 shrink-0 text-ink-extra-muted'
            }
          />
        </Button>
        <Show when={speed()}>
          <SpeedButton mobile={props.mobile} />
        </Show>
      </div>
      <Show when={(custom() && state.model) || thinking()}>
        <div class="flex flex-col gap-2">
          <Show when={custom() && state.model}>
            <ModelSelectorModelRow
              mobile={props.mobile}
              onModels={props.onModels}
            />
          </Show>
          <Show when={thinking()}>
            <ThinkingSlider
              effort={state.effort}
              value={state.effortValue}
              disabled={state.effortDisabled || state.disabled}
              mobile={props.mobile}
              onCommit={state.onEffort}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}
