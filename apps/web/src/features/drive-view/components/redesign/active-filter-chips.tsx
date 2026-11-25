import { t } from '@app/lib/i18n';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';

export type ActiveFilterChip = {
  key: string;
  groupLabel: string;
  valueLabel: string;
  onRemove: () => void;
};

/**
 * Dismissible chip bar shown beneath the header only while filters are active.
 */
export function ActiveFilterChips(props: {
  chips: readonly ActiveFilterChip[];
  onClearAll: () => void;
}) {
  return (
    <Show when={props.chips.length > 0}>
      <div
        role="region"
        aria-label={t('drive.viewOptions')}
        class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-edge-muted bg-panel/60 px-4 py-1.5"
      >
        <For each={props.chips}>
          {(chip) => (
            <span class="inline-flex max-w-56 items-center gap-1 rounded-full border border-edge-muted bg-surface py-0.5 pl-2.5 pr-1 text-xs text-ink">
              <span class="shrink-0 text-ink-muted">{chip.groupLabel}:</span>
              <span class="truncate font-medium">{chip.valueLabel}</span>
              <button
                type="button"
                aria-label={t('drive.activeFilterRemove', {
                  label: `${chip.groupLabel} ${chip.valueLabel}`,
                })}
                class="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                onClick={chip.onRemove}
              >
                <CloseIcon class="size-2.5" aria-hidden="true" />
              </button>
            </span>
          )}
        </For>
        <Button
          variant="ghost"
          size="xs"
          class="text-xs text-ink-muted hover:text-ink"
          onClick={props.onClearAll}
        >
          {t('drive.clearAllFilters')}
        </Button>
      </div>
    </Show>
  );
}
