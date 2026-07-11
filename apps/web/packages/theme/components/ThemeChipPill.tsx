import { type ComponentProps, Show, splitProps, type ValidComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';
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
} & ComponentProps<'button'>;

/**
 * A theme swatch + name, outline-free. Polymorphic via `as` so the same chip can
 * be a plain button (the theme mention chip) or a dropdown trigger (the theme
 * pickers in settings/Appearance) and stay visually identical.
 */
export function ThemeChipPill(props: ThemeChipPillProps) {
  const [local, rest] = splitProps(props, ['as', 'theme', 'name', 'class']);
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
      <span class="flex items-center cursor-default">{local.name}</span>
    </Dynamic>
  );
}
