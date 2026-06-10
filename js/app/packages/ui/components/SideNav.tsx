import { type Component, createSignal, type ParentProps, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { Button } from './Button';

/**
 * Shared base + active styling for a vertical nav row (icon + label, ghost
 * button). Used by {@link SideNav.Item} and the app sidebar's row components so
 * the row visuals live in one place. Horizontal padding and any container-
 * specific modifiers (e.g. slim-mode `justify-center`) are intentionally left
 * to the caller to append via `cn`.
 */
const NAV_ROW_BASE =
  'flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-md py-1 text-ink-extra-muted not-disabled:hover:bg-ink/3';
const NAV_ROW_ACTIVE = 'bg-ink/6 not-disabled:hover:bg-ink/6 text-ink';

export function navRowClass(opts?: { active?: boolean }) {
  return cn(NAV_ROW_BASE, opts?.active && NAV_ROW_ACTIVE);
}

/*
<SideNav>
  <SideNav.Group label="General">
    <SideNav.Item icon={SomeIcon} active onSelect={() => {}}>Account</SideNav.Item>
  </SideNav.Group>
</SideNav>
*/

type SideNavProps = ParentProps<{ class?: string }>;

type SideNavGroupProps = ParentProps<{ label?: string; class?: string }>;

type SideNavIcon = Component<{ class?: string; triggerAnimation?: boolean }>;

type SideNavItemProps = ParentProps<{
  icon?: SideNavIcon;
  active?: boolean;
  disabled?: boolean;
  class?: string;
  onSelect?: () => void;
}>;

function SideNavRoot(props: SideNavProps) {
  return (
    <nav
      class={cn(
        'w-[220px] shrink-0 overflow-auto border-r border-edge-muted p-2 flex flex-col gap-2',
        props.class
      )}
    >
      {props.children}
    </nav>
  );
}

function SideNavGroup(props: SideNavGroupProps) {
  return (
    <div class={cn('flex flex-col', props.class)}>
      <Show when={props.label}>
        <div class="px-2 h-7 flex items-center text-xs text-ink-extra-muted">
          {props.label}
        </div>
      </Show>
      {props.children}
    </div>
  );
}

function SideNavItem(props: SideNavItemProps) {
  const [hovering, setHovering] = createSignal(false);

  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    props.onSelect?.();
  };

  return (
    <Button
      variant="ghost"
      disabled={props.disabled}
      class={cn(navRowClass({ active: props.active }), 'px-2', props.class)}
      onClick={handleClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Show when={props.icon}>
        {(icon) => (
          <div class="size-4 shrink-0">
            <Dynamic component={icon()} triggerAnimation={hovering()} />
          </div>
        )}
      </Show>
      <span class="whitespace-nowrap">{props.children}</span>
    </Button>
  );
}

export const SideNav = Object.assign(SideNavRoot, {
  Group: SideNavGroup,
  Item: SideNavItem,
});
