import { Button } from '@ui';
import { For } from 'solid-js';
import type { AvailabilityChange } from '../core/availability';

export function AvailabilityTypePicker(props: {
  mode: AvailabilityChange['mode'];
  label?: string;
  disabled?: boolean;
  onChange: (mode: AvailabilityChange['mode']) => void;
}) {
  return (
    <div
      class="flex flex-wrap gap-2"
      role="group"
      aria-label={props.label ?? 'Availability type'}
    >
      <For
        each={[
          { value: 'available' as const, label: 'Available' },
          { value: 'unavailable' as const, label: 'Unavailable' },
        ]}
      >
        {(option) => (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={props.disabled}
            tooltip={
              option.value === 'available'
                ? 'Choose available hours'
                : 'Choose time off'
            }
            aria-pressed={props.mode === option.value}
            class={`rounded-full border px-4 ${
              props.mode === option.value
                ? option.value === 'available'
                  ? 'border-accent bg-accent text-accent-contrast not-touch:not-disabled:hover:bg-accent not-touch:not-disabled:hover:text-accent-contrast'
                  : 'border-edge bg-edge text-ink not-touch:not-disabled:hover:bg-edge not-touch:not-disabled:hover:text-ink'
                : 'border-edge-muted text-ink-muted not-touch:not-disabled:hover:text-ink-muted'
            }`}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </Button>
        )}
      </For>
    </div>
  );
}
