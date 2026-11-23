import CaretRight from '@icon/system/regular/caret-right.svg';
import { Button } from '@ui';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { ThinkingSlider } from '../../components/unified-model-selector/thinking-slider';
import { MACRO_PERSONA_ID } from '../../core/roster';
import { ModelSelectorIdentity } from './model-selector-identity';
import { SpeedButton } from './speed-button';

export function ModelSelectorCard(props: {
  mobile?: boolean;
  onSelect: () => void;
}) {
  const state = useUnifiedModelSelector();
  const controls = () =>
    (!state.agent || state.agent.id === MACRO_PERSONA_ID) &&
    state.model?.toLowerCase() !== 'auto';
  return (
    <div
      class="m-2 flex flex-col bg-ink/8"
      classList={{
        'rounded-lg gap-2.5 px-3 pt-2.5 pb-3.5': !props.mobile && controls(),
        'rounded-lg px-3 py-2': !props.mobile && !controls(),
        'rounded-[20px] gap-3.5 px-1.5 pt-1.5 pb-4': Boolean(props.mobile),
      }}
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
            'min-w-0 not-touch:hover:bg-ink/12 active:bg-ink/12 text-ink font-medium',
            props.mobile
              ? 'h-11 min-h-11 rounded-[14px] pl-2.5 pr-3 gap-2.5 text-base leading-[22px]'
              : '-ml-1.5 h-7 min-h-7 rounded-md px-1.5 gap-2 text-sm'
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
        <Show when={controls()}>
          <div classList={{ 'pr-1.5': Boolean(props.mobile) }}>
            <SpeedButton mobile={props.mobile} />
          </div>
        </Show>
      </div>
      <Show when={controls()}>
        <div classList={{ 'px-2.5': Boolean(props.mobile) }}>
          <ThinkingSlider
            effort={state.effort}
            value={state.effortValue}
            disabled={state.effortDisabled || state.disabled}
            mobile={props.mobile}
            onCommit={state.onEffort}
          />
        </div>
      </Show>
    </div>
  );
}
