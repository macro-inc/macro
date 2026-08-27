import { cn } from '@ui';

type SpeechBubbleWhispProps = {
  /** Which corner the tail grows from. User bubbles and the composer sit on the right. */
  side?: 'right' | 'left';
};

/**
 * iMessage-style scooped tail for a raised glass speech bubble. Sits outside
 * the bubble so `overflow` on the surface doesn't clip it.
 */
export function SpeechBubbleWhisp(props: SpeechBubbleWhispProps) {
  const side = () => props.side ?? 'right';

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 16"
      class={cn(
        'pointer-events-none absolute bottom-0 h-4 w-5',
        side() === 'right' ? '-right-2.5' : '-left-2.5 -scale-x-100'
      )}
    >
      <path
        d="M0 2c1 8 8 12.5 20 14H0V2Z"
        fill="var(--color-menu-glass)"
      />
    </svg>
  );
}
