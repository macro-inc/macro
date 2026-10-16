import { createSignal, For, Show } from 'solid-js';
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
        class="px-3 py-0.5"
        classList={{ 'opacity-50': props.disabled }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          class="relative rounded-sm has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-edge-focus"
          title={`Effort: ${label()}`}
        >
          <div class="flex h-6 items-center gap-1" aria-hidden="true">
            <For each={choices()}>
              {(_, position) => (
                <span
                  class="h-1.5 min-w-0 flex-1 rounded-sm transition-colors"
                  classList={{
                    'bg-ink/60': position() <= index(),
                    'bg-ink/10': position() > index(),
                  }}
                />
              )}
            </For>
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
            class="absolute inset-0 m-0 h-full w-full opacity-0"
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
      </div>
    </Show>
  );
}
