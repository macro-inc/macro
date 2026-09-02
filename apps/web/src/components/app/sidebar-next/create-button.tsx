import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { TOKENS } from '@core/hotkey/tokens';
import PlusIcon from '@phosphor/plus.svg';
import { cn, Tooltip } from '@ui';
import type { ComponentProps } from 'solid-js';
import {
  SidebarItemNext,
  type SidebarItemNextProps,
} from './sidebar-item-next';

/**
 * SidebarNext's create trigger — the restyling seam.
 *
 * A plain `<button>`, so it does not inherit `@ui`'s `Button` variant stack the
 * way the old sidebar's trigger does. Kobalte spreads the trigger props (ref,
 * aria, handlers) through `as`, so all this has to do is forward them and
 * paint; the open state comes from Kobalte's `data-expanded`.
 *
 * Icon-only, so the label lives in the tooltip. Tooltip renders its own
 * wrapper element with its own ref, so the dropdown's ref still lands on the
 * button.
 */
const CreateTrigger = (props: ComponentProps<'button'>) => (
  <Tooltip
    label="Create"
    hotkey={TOKENS.global.createCommand}
    placement="bottom"
    as="span"
  >
    <button
      {...props}
      type="button"
      aria-label="Create"
      class={cn(
        'flex size-9 shrink-0 cursor-default select-none items-center justify-center',
        'rounded-full bg-surface-2 text-ink-muted shadow-sm outline-none',
        'transition-colors duration-150 ease-out motion-reduce:transition-none',
        'hover:bg-ink/4 hover:text-ink',
        'data-expanded:bg-ink/6 data-expanded:text-ink',
        'focus-visible:ring-2 focus-visible:ring-accent/40',
        props.class
      )}
    >
      <PlusIcon class="size-5 shrink-0" />
    </button>
  </Tooltip>
);

export const SidebarNextCreateButton = (props: {
  onMenuOpenChange?: (open: boolean) => void;
}) => (
  <SidebarCreateMenu
    trigger={CreateTrigger}
    onMenuOpenChange={props.onMenuOpenChange}
  />
);

/**
 * The rail's create trigger.
 *
 * Rendered through `SidebarItemNext` with the same `railBoxed` variant the
 * search button uses, rather than composing those classes by hand — that way
 * the two cannot drift apart when the variant is restyled. Kobalte's trigger
 * props arrive via `as` and `SidebarItemNext` spreads them onto its root
 * button, so the ref and handlers still land in the right place.
 */
const RailCreateTrigger = (props: SidebarItemNextProps) => (
  <SidebarItemNext
    {...props}
    variant="railBoxed"
    icon={PlusIcon}
    label="Create"
    tooltip="Create"
    tooltipPlacement="right"
    hotkey={TOKENS.global.createCommand}
  />
);

export const SidebarRailCreateButton = (props: {
  onMenuOpenChange?: (open: boolean) => void;
}) => (
  <SidebarCreateMenu
    trigger={RailCreateTrigger}
    onMenuOpenChange={props.onMenuOpenChange}
  />
);
