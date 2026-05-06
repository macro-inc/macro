import { cn } from '../utils/classname';
import { type ParentProps, splitProps, type JSX } from 'solid-js';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'fill';

export type AvatarProps = ParentProps<
  JSX.HTMLAttributes<HTMLDivElement> & {
    size?: AvatarSize;
    class?: string;
  }
>;

/**
 * Avatar container sizing classes using data attribute selectors.
 * Sets `data-size` and `group/avatar` so children can respond via
 * `group-data-[size=X]/avatar:` selectors.
 */
const AVATAR_SIZE_CLASSES = cn(
  // Base size (md)
  'size-8',
  // Size variants
  'data-[size=xs]:size-4',
  'data-[size=sm]:size-6',
  'data-[size=lg]:size-10',
  'data-[size=xl]:size-25',
  'data-[size=fill]:size-full'
);

/**
 * SVG icon sizing classes for direct SVG children.
 * Automatically sizes any SVG placed as a child of Avatar.
 */
const AVATAR_SVG_CLASSES = cn(
  // Base size (md)
  '[&>svg]:size-4',
  // Size variants
  'data-[size=xs]:[&>svg]:size-2',
  'data-[size=sm]:[&>svg]:size-3',
  'data-[size=lg]:[&>svg]:size-5',
  'data-[size=xl]:[&>svg]:size-16',
  'data-[size=fill]:[&>svg]:size-1/2'
);

/**
 * Avatar root container. Provides sizing and styling context for children.
 *
 * @example
 * <Avatar size="lg">
 *   <Avatar.Image src={url} alt="User" />
 *   <Avatar.Fallback>JD</Avatar.Fallback>
 * </Avatar>
 */
export function Avatar(props: AvatarProps) {
  const [local, others] = splitProps(props, ['size', 'class', 'children']);
  const size = () => local.size ?? 'md';

  return (
    <div
      data-slot="avatar"
      data-size={size()}
      class={cn(
        'group/avatar relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-ink-extra-muted text-panel',
        size() === 'fill' && '@container',
        AVATAR_SIZE_CLASSES,
        AVATAR_SVG_CLASSES,
        local.class
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}

export type AvatarImageProps = {
  src: string;
  alt?: string;
  class?: string;
  onError?: JSX.EventHandler<HTMLImageElement, Event>;
  ref?: (el: HTMLImageElement) => void;
};

/**
 * Avatar image. Fills the avatar container.
 */
function AvatarImage(props: AvatarImageProps) {
  return (
    <img
      ref={props.ref}
      src={props.src}
      alt={props.alt}
      class={cn('size-full object-cover rounded-full', props.class)}
      onError={props.onError}
    />
  );
}

export type AvatarFallbackProps = ParentProps<{
  class?: string;
}>;

/**
 * Avatar fallback content (typically initials or an icon).
 * Automatically sizes text based on parent avatar's data-size.
 */
function AvatarFallback(props: AvatarFallbackProps) {
  return (
    <span
      class={cn(
        'leading-none select-none flex items-center justify-center',
        // Base size (md)
        'text-lg',
        'group-data-[size=xs]/avatar:text-[8px]',
        'group-data-[size=sm]/avatar:text-xs',
        'group-data-[size=lg]/avatar:text-lg',
        'group-data-[size=xl]/avatar:text-[48px]',
        'group-data-[size=fill]/avatar:text-[min(50cqw,3rem)]',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

// Attach sub-components
Avatar.Image = AvatarImage;
Avatar.Fallback = AvatarFallback;

// ---------- AvatarGroup ----------

export type AvatarGroupSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type AvatarGroupProps = ParentProps<
  JSX.HTMLAttributes<HTMLDivElement> & {
    size?: AvatarGroupSize;
    class?: string;
  }
>;

/**
 * Overlap spacing for avatar groups by size.
 */
const GROUP_OVERLAP_CLASSES: Record<AvatarGroupSize, string> = {
  xs: '-space-x-1.5',
  sm: '-space-x-2',
  md: '-space-x-2.5',
  lg: '-space-x-3',
  xl: '-space-x-8',
};

/**
 * Ring classes applied to child avatars for separation.
 */
const GROUP_RING_CLASSES: Record<AvatarGroupSize, string> = {
  xs: '*:data-[slot=avatar]:ring-1',
  sm: '*:data-[slot=avatar]:ring-2',
  md: '*:data-[slot=avatar]:ring-2',
  lg: '*:data-[slot=avatar]:ring-2',
  xl: '*:data-[slot=avatar]:ring-4',
};

/**
 * Avatar group container. Displays avatars in an overlapping style.
 *
 * Uses --avatar-group-separator CSS variable for ring color (defaults to --color-panel).
 * Parent containers can override to match hover backgrounds.
 *
 * @example
 * <AvatarGroup size="sm">
 *   <Avatar size="sm"><Avatar.Fallback>AB</Avatar.Fallback></Avatar>
 *   <Avatar size="sm"><Avatar.Fallback>CD</Avatar.Fallback></Avatar>
 *   <AvatarGroup.Count size="sm">+3</AvatarGroup.Count>
 * </AvatarGroup>
 *
 * @example Matching hover background
 * <div class="hover:bg-hover hover:[--avatar-group-separator:var(--color-hover)]">
 *   <AvatarGroup size="sm">...</AvatarGroup>
 * </div>
 */
export function AvatarGroup(props: AvatarGroupProps) {
  const [local, others] = splitProps(props, ['size', 'class', 'children']);
  const size = () => local.size ?? 'md';

  return (
    <div
      data-slot="avatar-group"
      data-size={size()}
      class={cn(
        'isolate flex w-fit shrink-0 items-center',
        GROUP_OVERLAP_CLASSES[size()],
        GROUP_RING_CLASSES[size()],
        '*:data-[slot=avatar]:ring-[var(--avatar-group-separator,var(--color-panel))]',
        local.class
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}

export type AvatarGroupCountProps = ParentProps<{
  size?: AvatarGroupSize;
  class?: string;
}>;

/**
 * Count sizing classes for overflow indicator.
 */
const GROUP_COUNT_CLASSES: Record<AvatarGroupSize, string> = {
  xs: 'size-4 text-[9px] ring-1',
  sm: 'size-6 text-xs ring-2',
  md: 'size-8 text-sm ring-2',
  lg: 'size-10 text-base ring-2',
  xl: 'size-25 text-2xl ring-4',
};

/**
 * Overflow count indicator for avatar groups.
 */
function AvatarGroupCount(props: AvatarGroupCountProps) {
  const size = () => props.size ?? 'md';

  return (
    <div
      data-slot="avatar-group-count"
      class={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full bg-menu text-ink leading-none',
        'ring-[var(--avatar-group-separator,var(--color-panel))]',
        GROUP_COUNT_CLASSES[size()],
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

// Attach AvatarGroup sub-components
AvatarGroup.Count = AvatarGroupCount;
