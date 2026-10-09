import { Button } from '@ui';
import { For, Show } from 'solid-js';
import type {
  EffortChoice,
  SelectSessionConfigOption,
} from '../state/session-config';

/** Cycle the runtime's advertised effort choices without opening a menu. */
export function EffortDial(props: {
  config?: SelectSessionConfigOption;
  value?: string;
  disabled?: boolean;
  onChange: (choice: EffortChoice) => void;
}) {
  const choices = () => props.config?.options ?? [];
  const index = () =>
    choices().findIndex(
      (choice) => choice.value === (props.value ?? props.config?.currentValue)
    );
  const label = () => choices()[index()]?.name ?? 'Default';
  const fraction = () =>
    Math.max(0, index()) / Math.max(1, choices().length - 1);
  const select = (next: number) => {
    const choice = choices()[next];
    if (!props.disabled && props.config && choice) {
      props.onChange({
        configId: props.config.id,
        value: choice.value,
        name: choice.name,
      });
    }
  };
  return (
    <Show when={choices().length > 1}>
      <Button
        variant="ghost"
        size="icon-sm"
        class="size-[34px] shrink-0 rounded-full text-ink-muted hover:text-ink touch:min-h-9 touch:min-w-9"
        aria-label={`Reasoning effort: ${label()}`}
        title={`${label()} effort · Click for ${choices()[(index() + 1) % choices().length]?.name}`}
        disabled={props.disabled}
        onPointerDown={(event: PointerEvent) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseDown={(event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          select((index() + 1) % choices().length);
        }}
        onKeyDown={(event) => {
          const step =
            event.key === 'ArrowUp' || event.key === 'ArrowRight'
              ? 1
              : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
                ? -1
                : 0;
          if (!step && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          event.stopPropagation();
          select(
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? choices().length - 1
                : Math.max(0, Math.min(choices().length - 1, index() + step))
          );
        }}
      >
        <svg viewBox="0 0 24 24" class="size-5" fill="none" aria-hidden="true">
          <For each={Array.from({ length: 9 }, (_, i) => i)}>
            {(tick) => (
              <path
                d="M12 2.5V5"
                transform={`rotate(${-135 + tick * 33.75} 12 12)`}
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                class="transition-opacity duration-150 motion-reduce:transition-none"
                opacity={tick / 8 <= fraction() ? 1 : 0.2}
              />
            )}
          </For>
          <g
            style={{
              transform: `rotate(${-135 + fraction() * 270}deg)`,
              'transform-origin': '12px 12px',
            }}
            class="transition-transform duration-200 motion-reduce:transition-none"
          >
            <path
              d="M12 12V7.5"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
            />
          </g>
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        </svg>
      </Button>
    </Show>
  );
}
