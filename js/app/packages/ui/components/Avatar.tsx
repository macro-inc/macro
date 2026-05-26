import { cn } from '../utils/classname';
import { type ParentProps, splitProps, type JSX } from 'solid-js';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'fill';

export type AvatarProps = ParentProps<
  JSX.HTMLAttributes<HTMLDivElement> & {
    size?: AvatarSize;
    class?: string;
  }
>;

const AVATAR_SIZE_CLASSES = cn(
  'size-4',
  'data-[size=md]:size-6',
  'data-[size=lg]:size-10',
  'data-[size=fill]:size-full'
);

const AVATAR_SVG_CLASSES = cn(
  '[&>svg]:size-2',
  'data-[size=md]:[&>svg]:size-3',
  'data-[size=lg]:[&>svg]:size-5',
  'data-[size=fill]:[&>svg]:size-1/2'
);

/**
 * Avatar root. Provides sizing and styling context for children.
 * @example
 * <Avatar size="lg">
 *   <Avatar.Image src={url} alt="User" />
 *   <Avatar.Fallback>JD</Avatar.Fallback>
 * </Avatar>
 */
export function Avatar(props: AvatarProps) {
  const [local, rest] = splitProps(props, ['size', 'class', 'children']);
  const size = () => local.size ?? 'sm';

  return (
    <div
      data-slot="avatar"
      data-size={size()}
      class={cn(
        'group/avatar relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-ink-extra-muted has-[img]:bg-transparent text-surface',
        size() === 'fill' && '@container',
        AVATAR_SIZE_CLASSES,
        AVATAR_SVG_CLASSES,
        local.class
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
}

type AvatarImageProps = {
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
      class={cn('size-full object-cover', props.class)}
      onError={props.onError}
      alt={props.alt}
      ref={props.ref}
      src={props.src}
    />
  );
}

type AvatarFallbackProps = ParentProps<{
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
        'text-[8px]',
        'group-data-[size=md]/avatar:text-xs',
        'group-data-[size=lg]/avatar:text-lg',
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

export type AvatarGroupSize = 'sm' | 'md' | 'lg';

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
  sm: '-space-x-1.5',
  md: '-space-x-2',
  lg: '-space-x-3',
};

/**
 * Ring classes applied to child avatars for separation.
 */
const GROUP_RING_CLASSES: Record<AvatarGroupSize, string> = {
  sm: '**:data-[slot=avatar]:ring-1',
  md: '**:data-[slot=avatar]:ring-2',
  lg: '**:data-[slot=avatar]:ring-2',
};

/**
 * Avatar group container. Displays avatars in an overlapping style.
 *
 * Uses --avatar-group-separator CSS variable for ring color (defaults to --color-surface).
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
  const size = () => local.size ?? 'sm';

  return (
    <div
      data-slot="avatar-group"
      data-size={size()}
      class={cn(
        'isolate flex w-fit shrink-0 items-center',
        GROUP_OVERLAP_CLASSES[size()],
        GROUP_RING_CLASSES[size()],
        '**:data-[slot=avatar]:ring-(--avatar-group-separator,var(--color-surface))',
        local.class
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}

type AvatarGroupCountProps = ParentProps<{
  size?: AvatarGroupSize;
  class?: string;
}>;

/**
 * Count sizing classes for overflow indicator.
 */
const GROUP_COUNT_CLASSES: Record<AvatarGroupSize, string> = {
  sm: 'size-4 text-[9px] ring-1',
  md: 'size-6 text-xs ring-2',
  lg: 'size-10 text-base ring-2',
};

/**
 * Overflow count indicator for avatar groups.
 */
function AvatarGroupCount(props: AvatarGroupCountProps) {
  const size = () => props.size ?? 'sm';

  return (
    <div
      data-slot="avatar-group-count"
      class={cn(
        'relative z-10 flex shrink-0 select-none items-center justify-center rounded-full bg-surface text-ink leading-none',
        'ring-(--avatar-group-separator,var(--color-surface))',
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
