import { splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';

/**
 * A vertical nav row rendered as a ghost {@link Button}: the shared base/active
 * styling for sidebar-style rows (icon + label). Used by the settings `SideNav`
 * and the app sidebar's row components so the row visuals live in one place.
 *
 * Owns only the base + active visuals. Container-specific modifiers — horizontal
 * padding, slim-mode `justify-center`, etc. — are passed through via `class`,
 * which is merged last so callers can extend without leaking layout concerns in.
 */
const NAV_ROW_BASE =
  'flex items-center justify-start text-sm gap-2 cursor-default w-full rounded-md py-1 text-ink-extra-muted not-disabled:hover:bg-ink/3';
const NAV_ROW_ACTIVE = 'bg-ink/6 not-disabled:hover:bg-ink/6 text-ink';

export type NavRowProps = ButtonProps & { active?: boolean };

export const NavRow = (props: NavRowProps) => {
  const [local, rest] = splitProps(props, ['active', 'class']);
  return (
    <Button
      variant="ghost"
      {...rest}
      class={cn(NAV_ROW_BASE, local.active && NAV_ROW_ACTIVE, local.class)}
    />
  );
};
