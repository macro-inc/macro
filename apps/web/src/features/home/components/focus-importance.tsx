import { t } from '@app/lib/i18n';
import { cn, Tooltip } from '@ui';
import { For } from 'solid-js';

// Shared recommendation meter: more bars and warmer colors mean higher importance.
const IMPORTANCE_LEVELS = [
  { from: 80, lit: 5, color: 'bg-red', label: 'importanceVeryHigh' },
  { from: 60, lit: 4, color: 'bg-orange', label: 'importanceHigh' },
  { from: 40, lit: 3, color: 'bg-yellow', label: 'importanceMedium' },
  { from: 20, lit: 2, color: 'bg-lime', label: 'importanceLow' },
  { from: 5, lit: 1, color: 'bg-green', label: 'importanceVeryLow' },
  { from: 0, lit: 0, color: '', label: 'importanceNone' },
] as const;
const BARS = [0, 1, 2, 3, 4] as const;

export function FocusImportance(props: { importance: number }) {
  const level = () =>
    IMPORTANCE_LEVELS.find((band) => props.importance >= band.from) ??
    IMPORTANCE_LEVELS[IMPORTANCE_LEVELS.length - 1];
  const label = () => t(`forYou.${level().label}`);
  return (
    <Tooltip as="span" label={label()} class="inline-flex shrink-0">
      <span role="img" aria-label={label()} class="flex items-center gap-2">
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
