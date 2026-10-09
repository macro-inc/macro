import { createSignal, Show } from 'solid-js';
import type {
  EffortChoice,
  SelectSessionConfigOption,
} from '../state/session-config';

/** A discrete slider over the selected model's advertised effort choices. */
export function EffortSlider(props: {
  config?: SelectSessionConfigOption;
  value?: string;
  disabled?: boolean;
  onChange: (choice: EffortChoice) => void;
}) {
  const [dragging, setDragging] = createSignal<number>();
  const choices = () => props.config?.options ?? [];
  const index = () =>
    dragging() ??
    Math.max(
      0,
      choices().findIndex(
        (choice) => choice.value === (props.value ?? props.config?.currentValue)
      )
    );
  const label = () => choices()[index()]?.name ?? '';
  return (
    <Show when={choices().length > 1}>
      <div
        class="px-3 pt-2 pb-1"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="flex items-center justify-between text-xs text-ink-muted">
          <span>Effort</span>
          <span class="font-medium text-ink">{label()}</span>
        </div>
        <input
          type="range"
          min="0"
          max={choices().length - 1}
          step="1"
          value={index()}
          aria-label="Reasoning effort"
          aria-valuetext={label()}
          disabled={props.disabled}
          class="h-7 w-full accent-ink disabled:opacity-50"
          onInput={(event) => setDragging(Number(event.currentTarget.value))}
          onChange={(event) => {
            const choice = choices()[Number(event.currentTarget.value)];
            if (!props.disabled && props.config && choice)
              props.onChange({
                configId: props.config.id,
                value: choice.value,
                name: choice.name,
              });
            setDragging(undefined);
          }}
        />
      </div>
    </Show>
  );
}
