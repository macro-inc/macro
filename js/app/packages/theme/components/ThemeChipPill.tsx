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
 * A theme swatch + name inside a bordered, rounded-md pill: the swatch sits flush
 * on the left (its own border stripped, inner corners rounded-[5px]) and fills the
 * pill height. Polymorphic via `as` so the same pill can be a plain button (the
 * theme mention chip) or a dropdown trigger (the preferred-theme picker in
 * settings/Appearance) and stay visually identical.
 */
export function ThemeChipPill(props: ThemeChipPillProps) {
  const [local, rest] = splitProps(props, ['as', 'theme', 'name', 'class']);
  return (
    <Dynamic
      component={local.as ?? 'button'}
      class={cn(
        'inline-flex items-stretch gap-0.75 overflow-hidden rounded-md border border-edge-muted bg-transparent py-0 pl-0 pr-1',
        local.class
      )}
      {...rest}
    >
      <Show when={local.theme}>
        {(theme) => (
          <span class="inline-flex self-stretch rounded-md [&>span]:h-full [&>span]:rounded-[5px] [&>span]:border-0">
            <ThemeChips theme={theme()} size="sm" />
          </span>
        )}
      </Show>
      <span class="mx-0.5 flex items-center cursor-default">{local.name}</span>
    </Dynamic>
  );
}
