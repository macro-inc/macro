import { cn, Tooltip } from '@ui';
import { For } from 'solid-js';

// Match the score bands and geometry used by email's Focus view.
const IMPORTANCE_LEVELS = [
  { from: 80, lit: 5, color: 'bg-green' },
  { from: 60, lit: 4, color: 'bg-lime' },
  { from: 40, lit: 3, color: 'bg-yellow' },
  { from: 20, lit: 2, color: 'bg-orange' },
  { from: 5, lit: 1, color: 'bg-red' },
  { from: 0, lit: 0, color: '' },
] as const;
const BARS = [0, 1, 2, 3, 4] as const;

export function FocusImportance(props: { importance: number; label?: string }) {
  const label = () => props.label ?? `Importance ${props.importance} of 100`;
  const level = () =>
    IMPORTANCE_LEVELS.find((band) => props.importance >= band.from) ??
    IMPORTANCE_LEVELS[IMPORTANCE_LEVELS.length - 1];
  return (
    <Tooltip as="span" label={label()} class="inline-flex shrink-0">
      <span role="img" aria-label={label()} class="flex items-center gap-2">
        <span class="w-[3ch] text-right text-xs font-medium tabular-nums text-ink-muted">
          {props.importance}
        </span>
        <span class="flex items-center gap-[3px]" aria-hidden="true">
          <For each={BARS}>
            {(bar) => (
              <span
                class={cn(
                  'h-3.5 w-1.5 rounded-full',
                  bar < level().lit ? level().color : 'bg-ink-extra-muted/25'
                )}
              />
            )}
          </For>
        </span>
      </span>
    </Tooltip>
  );
}
