import type { HotkeyToken } from '@core/hotkey/tokens';
import type { Placement } from '@floating-ui/dom';
import { cn, createVariants, Tooltip, type VariantProps } from '@ui';
import {
  type Component,
  createSignal,
  type JSX,
  Show,
  splitProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * Every visual state of a SidebarNext item, in one place.
 *
 * Deliberately not built on `@ui`'s `NavRow`: that is a ghost `Button`, so a
 * row's classes resolve through the button base, the ghost variant, the `md`
 * size, `NAV_ROW_BASE` and finally the call site — five layers, the last two
 * existing mostly to undo the first three. Restyling here means editing one
 * `createVariants` call.
 *
 * `NavRow` also wraps every row in `Layer` + `Tooltip` + Kobalte's `Button`.
 * This renders a plain `<button>` (or `<a>`) and wraps in `Tooltip` only when
 * a tooltip is asked for.
 */
const sidebarItemVariants = createVariants(
  cn(
    'group/item relative flex cursor-default select-none items-center',
    'text-ink-extra-muted outline-none',
    // Matches the icon cross-fade below so the label and glyph shift together.
    'transition-colors duration-150 ease-out motion-reduce:transition-none',
    'focus-visible:ring-2 focus-visible:ring-accent/40',
    'data-disabled:pointer-events-none data-disabled:opacity-40',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0'
  ),
  {
    variant: {
      nav: 'w-full gap-2 rounded-xl p-2 text-base font-medium text-ink-muted hover:bg-hover data-active:text-accent',
      search:
        'w-full gap-2 rounded-xl ring ring-edge-muted p-2 text-sm text-ink-placeholder bg-ink/2 hover:bg-ink/5',
      /** More Apps grid cell: icon stacked over a dark label. */
      tile: 'aspect-square flex-col justify-center gap-2 rounded-xl text-[12px] text-ink hover:bg-hover',
    },
    /**
     * Reserved for the nested lists these rows grow later. Keys are prefixed
     * because `createVariants` only extracts string keys, and TS normalises
     * numeric-looking property names to numbers.
     */
    indent: {
      i0: '',
      i1: 'pl-6',
      i2: 'pl-10',
    },
  },
  { variant: 'nav', indent: 'i0' }
);

type SidebarItemVariant = NonNullable<
  VariantProps<typeof sidebarItemVariants>['variant']
>;

/**
 * Icon box per variant. Phosphor glyphs are `fill="currentColor"`, so the row's
 * colour — including `data-active:text-accent` — carries into the icon.
 */
const ICON_BOX: Record<SidebarItemVariant, string> = {
  nav: 'size-5 [&_svg]:size-5',
  search: 'size-5 [&_svg]:size-4',
  tile: 'size-6 [&_svg]:size-6',
};

/**
 * The active-state cross-fade. Both weights are stacked in the icon box and
 * swapped by opacity alone, so neither reflows the row and the outline glyph
 * does not blink out before the filled one arrives.
 */
const ICON_SWAP_BASE = cn(
  'absolute inset-0 transition-opacity duration-150 ease-out',
  'motion-reduce:transition-none'
);
const ICON_SHOWN = 'opacity-100';
const ICON_HIDDEN = 'opacity-0';

/** Icon slot: the animated `wide-*` icons also take `triggerAnimation`. */
type SidebarItemIcon = Component<{
  class?: string;
  triggerAnimation?: boolean;
}>;

export type SidebarItemNextProps = {
  label: string;
  icon?: SidebarItemIcon;
  /**
   * Filled counterpart of `icon`, cross-faded in by `iconSwapOn`. Omit to keep
   * a single glyph in every state.
   */
  iconActive?: SidebarItemIcon;
  /**
   * What flips `icon` to `iconActive`. Defaults to `'active'`, which is what
   * the nav rows want. `'hover'` suits surfaces with no active state of their
   * own — the More Apps tiles, where every entry opens a new tab.
   */
  iconSwapOn?: 'active' | 'hover';
  /** Right edge of a `nav`/`search` item: hotkey hint, count, chevron. */
  trailing?: JSX.Element;
  /** Replaces `label` as the visible text; `label` stays the accessible name. */
  children?: JSX.Element;

  active?: boolean;
  disabled?: boolean;

  variant?: SidebarItemVariant;
  indent?: 0 | 1 | 2;
  class?: string;

  tooltip?: string;
  tooltipPlacement?: Placement;
  hotkey?: HotkeyToken | HotkeyToken[];

  /** Rendered as a real link so cmd/middle-click open a browser tab. */
  href?: string;
  target?: string;
  rel?: string;

  /**
   * The rows navigate on mousedown (matching the current sidebar, which does
   * so to beat focus changes); tiles and buttons use `onClick`.
   */
  onMouseDown?: (event: MouseEvent) => void;
  onClick?: (event: MouseEvent) => void;
  /**
   * Hover state, surfaced rather than left to the caller's own
   * `onMouseEnter`/`onMouseLeave`: the item needs those internally to drive the
   * animated icons, so a caller's handlers would replace them.
   */
  onHoverChange?: (hovering: boolean) => void;

  /** Escape hatch for e2e/test hooks, e.g. `data-sidebar-item`. */
  [key: `data-${string}`]: string | undefined;
};

export const SidebarItemNext = (props: SidebarItemNextProps) => {
  const [hovering, setHovering] = createSignal(false);
  const [local, rest] = splitProps(props, [
    'label',
    'icon',
    'iconActive',
    'iconSwapOn',
    'trailing',
    'children',
    'active',
    'disabled',
    'variant',
    'indent',
    'class',
    'tooltip',
    'tooltipPlacement',
    'hotkey',
    'href',
    'onHoverChange',
  ]);

  const setHover = (next: boolean) => {
    setHovering(next);
    local.onHoverChange?.(next);
  };

  const iconFilled = () =>
    local.iconSwapOn === 'hover' ? hovering() : !!local.active;

  const variant = () => local.variant ?? 'nav';
  const isTile = () => variant() === 'tile';

  const item = () => (
    <Dynamic
      component={local.href ? 'a' : 'button'}
      type={local.href ? undefined : 'button'}
      href={local.href}
      draggable={false}
      aria-label={local.label}
      aria-current={local.active ? 'page' : undefined}
      // Attribute rather than a class-only state so styles can be retargeted
      // from CSS, and so the `data-active` selectors the current sidebar's
      // tests use keep working.
      data-active={local.active ? '' : undefined}
      data-disabled={local.disabled ? '' : undefined}
      data-variant={variant()}
      aria-disabled={local.disabled ? 'true' : undefined}
      class={cn(
        sidebarItemVariants({
          variant: variant(),
          indent: `i${local.indent ?? 0}`,
        }),
        local.class
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...rest}
    >
      <Show when={local.icon}>
        {(icon) => (
          <div
            class={cn(
              'relative flex shrink-0 items-center justify-center size-4',
              ICON_BOX[variant()]
            )}
          >
            <Show
              when={local.iconActive}
              fallback={
                <Dynamic component={icon()} triggerAnimation={hovering()} />
              }
            >
              {(iconActive) => (
                <>
                  <Dynamic
                    component={icon()}
                    aria-hidden="true"
                    class={cn(
                      ICON_SWAP_BASE,
                      iconFilled() ? ICON_HIDDEN : ICON_SHOWN
                    )}
                  />
                  <Dynamic
                    component={iconActive()}
                    aria-hidden="true"
                    class={cn(
                      ICON_SWAP_BASE,
                      iconFilled() ? ICON_SHOWN : ICON_HIDDEN
                    )}
                  />
                </>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Show
        when={local.children !== undefined}
        fallback={<span class="max-w-full truncate">{local.label}</span>}
      >
        {local.children}
      </Show>

      <Show when={local.trailing}>
        <div class="ml-auto flex shrink-0 items-center">{local.trailing}</div>
      </Show>
    </Dynamic>
  );

  return (
    <Show when={local.tooltip} fallback={item()}>
      {(tooltip) => (
        <Tooltip
          label={tooltip()}
          hotkey={local.hotkey}
          placement={local.tooltipPlacement ?? 'right'}
          class={isTile() ? undefined : 'w-full'}
        >
          {item()}
        </Tooltip>
      )}
    </Show>
  );
};
