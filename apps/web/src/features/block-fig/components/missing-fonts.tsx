/**
 * Figma's "Missing fonts" notice: the fonts the design uses that are not
 * available, which text edited in them falls back to Inter for, with the
 * offer to use the fonts installed on this computer. Presentational.
 */

import type { FontUse } from '@core/fig-engine/types';
import WarningCircle from '@phosphor/warning-circle.svg';
import X from '@phosphor/x.svg';
import { createSignal, For, Show } from 'solid-js';

export function MissingFonts(props: {
  fonts: readonly FontUse[];
  /** Whether this browser can list the computer's fonts. */
  canUseLocal: boolean;
  onUseLocal: () => void;
}) {
  const [open, setOpen] = createSignal(true);
  const [expanded, setExpanded] = createSignal(false);
  const families = () => [...new Set(props.fonts.map((f) => f.family))];
  return (
    <Show when={open()}>
      <div
        class="absolute right-3 bottom-14 z-30 flex w-64 flex-col gap-1.5 rounded-xl border border-edge-muted bg-menu p-3 text-xs shadow-xl"
        data-testid="fig-missing-fonts"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div class="flex items-center gap-1.5 font-semibold text-ink">
          <WarningCircle class="size-3.5 shrink-0 text-warning" />
          <span class="flex-1">
            {families().length === 1
              ? 'Missing font'
              : `${families().length} missing fonts`}
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            class="rounded p-0.5 text-ink-muted hover:text-ink"
            onClick={() => setOpen(false)}
          >
            <X class="size-3" />
          </button>
        </div>
        <p class="text-ink-muted">
          Text in these fonts stays as it is; edited, it shows in Inter.
        </p>
        <ul class="flex flex-col gap-0.5">
          <For each={expanded() ? props.fonts : props.fonts.slice(0, 4)}>
            {(f) => (
              <li class="truncate text-ink" data-testid="fig-missing-font">
                {f.family} {f.style}
              </li>
            )}
          </For>
        </ul>
        <Show when={props.fonts.length > 4 && !expanded()}>
          <button
            type="button"
            class="self-start text-ink-muted hover:text-ink"
            onClick={() => setExpanded(true)}
          >
            {props.fonts.length - 4} more
          </button>
        </Show>
        <Show when={props.canUseLocal}>
          <button
            type="button"
            class="mt-1 rounded-md bg-inset px-2 py-1 text-ink hover:bg-hover"
            data-testid="fig-use-local-fonts"
            onClick={() => props.onUseLocal()}
          >
            Use fonts on this computer
          </button>
        </Show>
      </div>
    </Show>
  );
}
