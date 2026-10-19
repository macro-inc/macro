import {
  type BadgeSize,
  type BadgeVariant,
  badgeClasses,
  badgeTriggerClasses,
  cn,
} from '@ui';

type PropertyPillClassOptions = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  class?: string;
  readOnly?: boolean;
  empty?: boolean;
};

/** Shared surface for property pills, including non-property metadata. */
export function propertyPillClasses(props: PropertyPillClassOptions = {}) {
  const options = {
    variant: props.variant ?? 'ghost',
    size: props.size ?? 'sm',
    class: cn(
      'max-w-full text-left',
      props.empty && 'text-ink-extra-muted',
      props.class
    ),
  } as const;

  return props.readOnly ? badgeClasses(options) : badgeTriggerClasses(options);
}
