import {
  type BadgeSize,
  type BadgeVariant,
  badgeClasses,
  badgeTriggerClasses,
  cn,
} from '@ui';
import { splitProps } from 'solid-js';
import { useProperty } from '../core/context';
import { hasValue } from '../utils/typeGuards';
import {
  PropertyEditTrigger,
  type PropertyEditTriggerProps,
} from './PropertyEditTrigger';

export type PropertyPillProps = PropertyEditTriggerProps & {
  variant?: BadgeVariant;
  size?: BadgeSize;
};

/**
 * Canonical property-editor pill. It owns editability-aware interaction
 * styles while leaving property-specific icon, text, and caret composition to
 * its caller.
 */
export function PropertyPill(props: PropertyPillProps) {
  const ctx = useProperty();
  const [local, rest] = splitProps(props, ['variant', 'size', 'class']);
  const isReadOnly = () => !ctx.canEdit() || ctx.property().isMetadata;
  const isEmpty = () => !hasValue(ctx.property());

  const classes = () => {
    const options = {
      variant: local.variant ?? 'ghost',
      size: local.size ?? 'sm',
      class: cn(
        'max-w-full text-left',
        isEmpty() && 'text-ink-extra-muted',
        local.class
      ),
    } as const;

    return isReadOnly() ? badgeClasses(options) : badgeTriggerClasses(options);
  };

  return (
    <PropertyEditTrigger
      data-slot="property-pill"
      data-readonly={isReadOnly() ? '' : undefined}
      aria-disabled={isReadOnly()}
      class={classes()}
      {...rest}
    />
  );
}
