import { type ComponentProps, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { CONTROL_SIZE_VARIANTS } from '../utils/controlSizes';
import { createVariants, type VariantProps } from '../utils/variants';
import { buttonClasses } from './Button';

/** Canonical variant classes for badges and badge-like elements. */
export const badgeVariants = createVariants(
  cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap',
    'rounded-full border border-transparent font-medium',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0'
  ),
  {
    variant: {
      ghost: 'bg-transparent text-ink-muted',
      outline: 'bg-transparent text-ink-muted border-edge-muted',
    },
    size: {
      xs: "h-5 gap-1 px-2 text-xs [&>svg:not([class*='size-'])]:size-3 has-[>[data-slot=avatar][data-size=sm]:first-child]:pl-px",
      ...CONTROL_SIZE_VARIANTS,
      // A 16px avatar in a 24px pill has a 3px inset inside its 1px border.
      sm: cn(
        CONTROL_SIZE_VARIANTS.sm,
        'has-[>[data-slot=avatar][data-size=sm]:first-child]:pl-[3px]'
      ),
      md: cn(
        CONTROL_SIZE_VARIANTS.md,
        'has-[>[data-slot=avatar][data-size=md]:first-child]:pl-[3px]'
      ),
      lg: cn(
        CONTROL_SIZE_VARIANTS.lg,
        'has-[>[data-slot=avatar][data-size=md]:first-child]:pl-[5px]'
      ),
    },
  },
  {
    variant: 'ghost',
    size: 'md',
  }
);

/** Variant props inferred from the canonical badge variant definition. */
export type BadgeVariantProps = VariantProps<typeof badgeVariants>;
export type BadgeVariant = NonNullable<BadgeVariantProps['variant']>;
export type BadgeSize = NonNullable<BadgeVariantProps['size']>;

export type BadgeClassOptions = BadgeVariantProps & {
  class?: string;
};

export type BadgeProps = ComponentProps<'span'> & BadgeVariantProps;

/** Returns the canonical classes for a badge-like element. */
export function badgeClasses(options: BadgeClassOptions = {}): string {
  const { variant, size, class: className } = options;
  return cn(badgeVariants({ variant, size }), className, 'rounded-full');
}

/** Returns Button interaction styles with Badge variants, sizes, and shape. */
export function badgeTriggerClasses(options: BadgeClassOptions = {}): string {
  const { variant = 'ghost', size = 'md', class: className } = options;
  return cn(
    buttonClasses({
      variant,
      size,
      noTouchResize: true,
      class: className,
    }),
    'focus-visible:ring-2 focus-visible:ring-accent/20',
    'rounded-full'
  );
}

/** A non-interactive label with Button-aligned sizing.
 *
 * @do Keep badge text to a word or two.
 * @do Use a small leading Avatar in xs/sm badges, or medium in md/lg badges.
 * @do Use `badgeTriggerClasses` when a badge needs to behave like a button.
 * @do Use a palette color for identity (tags, calendars) and a semantic color
 *   for state.
 * @dont Do not attach a click handler to `Badge` directly — it renders a
 *   `span`.
 * @dont Do not use a badge where a Tooltip would carry the information better.
 */
export function Badge(props: BadgeProps) {
  const [local, others] = splitProps(props, ['variant', 'size', 'class']);
  const variant = () => local.variant ?? 'ghost';
  const size = () => local.size ?? 'md';

  return (
    <span
      data-slot="badge"
      data-variant={variant()}
      data-size={size()}
      class={badgeClasses({
        variant: variant(),
        size: size(),
        class: local.class,
      })}
      {...others}
    />
  );
}
