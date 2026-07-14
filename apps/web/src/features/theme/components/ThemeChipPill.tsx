import { type ComponentProps, Show, splitProps, type ValidComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { cn } from '@ui';
import type { ThemeV2 } from '../types/themeTypes';
import { ThemeChips } from './ThemeChips';

type ThemeChipPillProps = {
  /** Element/component to render as. Defaults to a <button>. */
  as?: ValidComponent;
  /** Theme whose swatch is shown; when absent, only the name renders. */
  theme?: ThemeV2 | null;
  /** Label shown beside the swatch. */
  name: string;
  /** Shows a trailing caret, signalling the pill opens a dropdown. */
  caret?: boolean;
  /**
   * Max-width class(es) for the label, overriding the default responsive
   * truncation — e.g. `max-w-none` to let a long label (like "System
   * preference") show in full.
   */
  maxLabelWidth?: string;
} & ComponentProps<'button'>;

/**
 * A theme swatch + name, outline-free. Polymorphic via `as` so the same chip can
 * be a plain button (the theme mention chip) or a dropdown trigger (the theme
 * pickers in settings/Appearance) and stay visually identical.
 */
export function ThemeChipPill(props: ThemeChipPillProps) {
  const [local, rest] = splitProps(props, [
    'as',
    'theme',
    'name',
    'class',
    'caret',
    'maxLabelWidth',
  ]);
  return (
    <Dynamic
      component={local.as ?? 'button'}
      class={cn(
        'inline-flex items-center gap-1.5 overflow-hidden rounded-md bg-transparent p-0',
        local.class
      )}
      {...rest}
    >
      <Show when={local.theme}>
        {(theme) => (
          <span class="inline-flex shrink-0">
            <ThemeChips theme={theme()} size="sm" />
          </span>
        )}
      </Show>
      {/* Shrink the truncation width as the split pane narrows so the pill
          doesn't crowd its row; `/split` variants no-op where there's no split
          container ancestor, falling back to the base width. Callers can widen
          it via `maxLabelWidth` (e.g. to show a long label in full). */}
      <span
        class={cn(
          'min-w-0 truncate cursor-default',
          local.maxLabelWidth ??
            'max-w-26 @max-[600px]/split:max-w-20 @max-[480px]/split:max-w-14'
        )}
        title={local.name}
      >
        {local.name}
      </span>
      <Show when={local.caret}>
        <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
      </Show>
    </Dynamic>
  );
}
