import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';

export type BubbleTone = 'incoming' | 'outgoing' | 'system';

/**
 * The tail fills the bubble's bottom corner and sweeps out to a point, the
 * way a phone's message bubbles do. It shares the bubble's fill, so it
 * reads as one shape.
 */
function BubbleTail(props: { side: 'start' | 'end' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 16"
      class={cn(
        'pointer-events-none absolute bottom-0 h-4 w-6 fill-(--bubble)',
        props.side === 'start' ? '-left-1.5' : '-right-1.5 -scale-x-100'
      )}
    >
      <path d="M0 16C3.6 15 6 12.5 6 6V0h18v16Z" />
    </svg>
  );
}

/**
 * One message as a speech bubble: incoming messages are neutral with the
 * tail on the left, the viewer's own are accent-colored on the right, and
 * system events (an edit, a status) are outlined without a tail.
 */
export function SpeechBubble(props: {
  text: string;
  tone: BubbleTone;
  /** Only the last bubble of a run gets a tail. */
  tail?: boolean;
  lines?: 1 | 2 | 3 | 4;
  size?: 'sm' | 'md';
  unread?: boolean;
  class?: string;
  children?: JSX.Element;
}) {
  const side = () => (props.tone === 'outgoing' ? 'end' : 'start');
  return (
    <div
      class={cn(
        'relative w-fit max-w-full min-w-0 rounded-[18px] break-words',
        props.size === 'sm'
          ? 'px-2.5 py-1 text-xs leading-4'
          : 'px-3 py-1.5 text-[13px] leading-[18px]',
        match(props.tone)
          .with('incoming', () => 'bg-(--bubble) text-ink')
          .with('outgoing', () => 'bg-(--bubble) text-accent-contrast')
          .with(
            'system',
            () => 'border border-edge-muted bg-panel text-ink-muted italic'
          )
          .exhaustive(),
        props.unread && props.tone === 'incoming' && 'font-medium',
        props.class
      )}
      style={{
        // Incoming bubbles are tinted toward the ink so they read on light
        // and dark panels alike; the tail shares the fill.
        '--bubble':
          props.tone === 'outgoing'
            ? 'var(--color-accent)'
            : 'color-mix(in oklch, var(--color-ink) 9%, var(--color-panel))',
      }}
    >
      <span
        class={cn(
          // Above the tail, which fills the bubble's bottom corner.
          'relative z-1 block',
          match(props.lines ?? 3)
            .with(1, () => 'line-clamp-1')
            .with(2, () => 'line-clamp-2')
            .with(3, () => 'line-clamp-3')
            .with(4, () => 'line-clamp-4')
            .exhaustive()
        )}
      >
        {props.text}
      </span>
      {props.children}
      <Show when={props.tail && props.tone !== 'system'}>
        <BubbleTail side={side()} />
      </Show>
    </div>
  );
}

/** The tone a message's bubble takes for the viewer. */
export function bubbleTone(message: {
  author?: { isSelf: boolean };
}): BubbleTone {
  if (!message.author) return 'system';
  return message.author.isSelf ? 'outgoing' : 'incoming';
}
