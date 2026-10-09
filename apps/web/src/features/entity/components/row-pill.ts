import { badgeClasses, cn } from '@ui';

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
