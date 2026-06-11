import { type Component, createSignal, type ParentProps, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { NavRow } from './NavRow';

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
    <NavRow
      active={props.active}
      disabled={props.disabled}
      class={cn('px-2', props.class)}
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
    </NavRow>
  );
}

export const SideNav = Object.assign(SideNavRoot, {
  Group: SideNavGroup,
  Item: SideNavItem,
});
