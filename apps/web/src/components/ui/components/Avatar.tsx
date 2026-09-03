import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  type ParentProps,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../utils/classname';
import { createVariants, type VariantProps } from '../utils/variants';

/**
 * Corner radius for a square avatar, stepped to match its size. Circles do not
 * vary, so this only covers `shape="square"`. Kept outside `avatarVariants`
 * because it depends on two groups at once, which `createVariants` does not
 * express.
 */
const SQUARE_RADIUS = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  fill: 'rounded-lg',
} as const;

/** Canonical variant classes for the avatar root. */
export const avatarVariants = createVariants(
  cn(
    'group/avatar relative flex shrink-0 select-none items-center justify-center overflow-hidden',
    'bg-ink-extra-muted has-[img:not([data-failed])]:bg-transparent text-surface'
  ),
  {
    size: {
      sm: 'size-4 [&>svg]:size-2',
      md: 'size-6 [&>svg]:size-3',
      lg: 'size-10 [&>svg]:size-5',
      fill: 'size-full @container [&>svg]:size-1/2',
    },
    shape: {
      rounded: 'rounded-full',
      // Square radius is size-dependent, so `avatarClasses` adds it.
      square: '',
    },
  },
  { size: 'sm', shape: 'rounded' }
);

/** Variant props inferred from the canonical avatar variant definition. */
export type AvatarVariantProps = VariantProps<typeof avatarVariants>;
export type AvatarSize = NonNullable<AvatarVariantProps['size']>;
export type AvatarShape = NonNullable<AvatarVariantProps['shape']>;

export type AvatarClassOptions = AvatarVariantProps & {
  highlightEdge?: boolean;
  class?: string;
};

/** Radius alone, for anything that has to trace the avatar's silhouette. */
export function avatarShapeClasses(
  size: AvatarSize = 'sm',
  shape: AvatarShape = 'rounded'
): string {
  return shape === 'rounded' ? 'rounded-full' : SQUARE_RADIUS[size];
}

/** Returns the canonical classes for the avatar root. */
export function avatarClasses(options: AvatarClassOptions = {}): string {
  const {
    size = 'sm',
    shape = 'rounded',
    highlightEdge = false,
    class: className,
  } = options;

  return cn(
    avatarVariants({ size, shape }),
    shape === 'square' && SQUARE_RADIUS[size],
    // Only the root draws the edge. `avatar-edge` is an outline, which paints
    // after every descendant and is not clipped by `overflow`, so it lands on
    // top of a covering image without the image needing one of its own.
    highlightEdge && 'avatar-edge',
    className
  );
}

type AvatarContextValue = {
  size: Accessor<AvatarSize>;
  shape: Accessor<AvatarShape>;
};

const AvatarContext = createContext<AvatarContextValue>();

/**
 * Lets the slots pick up the root's size and shape without every call site
 * repeating them. Falls back to the root's own defaults so a slot rendered
 * outside an `Avatar` still looks right.
 */
function useAvatarContext(): AvatarContextValue {
  return (
    useContext(AvatarContext) ?? {
      size: () => 'sm' as const,
      shape: () => 'rounded' as const,
    }
  );
}

export type AvatarProps = ParentProps<
  JSX.HTMLAttributes<HTMLDivElement> & {
    size?: AvatarSize;
    /** `rounded` is a circle; `square` uses a radius stepped to the size. */
    shape?: AvatarShape;
    /** Draws the edge hairline. Off by default. */
    highlightEdge?: boolean;
    class?: string;
  }
>;

/**
 * Avatar root. Provides sizing and styling context for children.
 * @example
 * <Avatar size="lg" shape="square" highlightEdge>
 *   <Avatar.Image src={url} alt="User" />
 *   <Avatar.Fallback>JD</Avatar.Fallback>
 * </Avatar>
 */
export function Avatar(props: AvatarProps) {
  const [local, rest] = splitProps(props, [
    'size',
    'shape',
    'highlightEdge',
    'class',
    'children',
  ]);
  const size = () => local.size ?? 'sm';
  const shape = () => local.shape ?? 'rounded';
  const highlightEdge = () => local.highlightEdge ?? false;

  return (
    <AvatarContext.Provider value={{ size, shape }}>
      <div
        data-slot="avatar"
        data-size={size()}
        data-shape={shape()}
        class={avatarClasses({
          size: size(),
          shape: shape(),
          highlightEdge: highlightEdge(),
          class: local.class,
        })}
        {...rest}
      >
        {local.children}
      </div>
    </AvatarContext.Provider>
  );
}

type AvatarImageProps = {
  src: string;
  alt?: string;
  class?: string;
  /** Overrides the size inherited from the enclosing `Avatar`. */
  size?: AvatarSize;
  /** Overrides the shape inherited from the enclosing `Avatar`. */
  shape?: AvatarShape;
  onError?: JSX.EventHandler<HTMLImageElement, Event>;
  ref?: (el: HTMLImageElement) => void;
};

/**
 * Avatar image. Fills the avatar container, inheriting its size and shape
 * unless given its own. The edge hairline stays on the root, whose outline
 * paints over this image.
 *
 * A source that fails to load hides itself so the fallback shows through
 * instead of the browser's broken-image glyph. The element stays mounted while
 * hidden, so an `onError` handler that retries by reassigning
 * `currentTarget.src` still works — a successful retry clears the failure.
 */
function AvatarImage(props: AvatarImageProps) {
  const [failed, setFailed] = createSignal(false);
  const context = useAvatarContext();

  const size = () => props.size ?? context.size();
  const shape = () => props.shape ?? context.shape();

  return (
    <img
      class={cn(
        'absolute inset-0 size-full object-cover',
        avatarShapeClasses(size(), shape()),
        failed() && 'hidden',
        props.class
      )}
      data-failed={failed() ? '' : undefined}
      onError={(event) => {
        // Caller first: it may swap in another URL, which onLoad then accepts.
        props.onError?.(event);
        setFailed(true);
      }}
      onLoad={() => setFailed(false)}
      alt={props.alt}
      ref={props.ref}
      src={props.src}
    />
  );
}

/** Fallback text scale per avatar size. */
const FALLBACK_TEXT = {
  sm: 'text-[8px]',
  md: 'text-xs',
  lg: 'text-lg',
  fill: 'text-[min(50cqw,3rem)]',
} as const;

type AvatarFallbackProps = ParentProps<{
  class?: string;
  /** Overrides the size inherited from the enclosing `Avatar`. */
  size?: AvatarSize;
}>;

/**
 * Avatar fallback content (typically initials or an icon). Text scales with the
 * size inherited from the enclosing `Avatar`.
 */
function AvatarFallback(props: AvatarFallbackProps) {
  const context = useAvatarContext();
  const size = () => props.size ?? context.size();

  return (
    <span
      class={cn(
        'leading-none select-none flex items-center justify-center',
        FALLBACK_TEXT[size()],
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
