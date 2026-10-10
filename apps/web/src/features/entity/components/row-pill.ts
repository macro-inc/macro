import { badgeClasses, badgeTriggerClasses, cn } from '@ui';

/**
 * A non-interactive row pill drawn like a tag pill (`tagPillClasses`): a
 * neutral outline with muted text, so pull request pills match email tags.
 */
export function rowPillClasses(className?: string): string {
  return badgeClasses({
    variant: 'outline',
    size: 'sm',
    class: cn(
      'min-w-0 border-edge-button bg-control text-ink-muted',
      className
    ),
  });
}

/**
 * An interactive row pill, the same classes as `tagPillClasses`. Kept here so
 * row pills don't pull the tag picker into every pull request surface.
 */
export function rowPillTriggerClasses(className?: string): string {
  return badgeTriggerClasses({
    variant: 'outline',
    size: 'sm',
    class: cn('min-w-0 text-ink-muted transition-colors', className),
  });
}
