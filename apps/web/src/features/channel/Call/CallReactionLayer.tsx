import { type Accessor, For } from 'solid-js';
import { CALL_REACTION_LIFETIME_MS, type CallReaction } from './call-reactions';
import './call-reactions.css';

export function CallReactionLayer(props: {
  root: Accessor<HTMLElement | undefined>;
  reactions: CallReaction[];
  compact?: boolean;
}) {
  const position = (reaction: CallReaction) => {
    const root = props.root();
    if (!root) return { left: '16px', bottom: '16px' };
    const bounds = root.getBoundingClientRect();
    const tile = Array.from(
      root.querySelectorAll<HTMLElement>('[data-call-participant]')
    ).find((element) => {
      if (
        element.dataset.callParticipant !== reaction.sender ||
        element.closest('[hidden]')
      )
        return false;
      const box = element.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.height > 0 &&
        box.bottom > bounds.top &&
        box.top < bounds.bottom &&
        box.left < bounds.right &&
        box.right > bounds.left
      );
    });
    if (!tile) return { left: '16px', bottom: '16px' };
    const box = tile.getBoundingClientRect();
    return {
      left: `${Math.max(16, box.left - bounds.left + 12)}px`,
      bottom: `${Math.max(16, bounds.bottom - box.bottom + 36)}px`,
    };
  };
  return (
    <div
      class="pointer-events-none absolute inset-0 z-40 overflow-hidden"
      aria-hidden="true"
      style={{
        '--call-reaction-duration': `${CALL_REACTION_LIFETIME_MS}ms`,
        '--call-reaction-rise': props.compact ? '48px' : '96px',
        '--call-reaction-sway': props.compact ? '3px' : '6px',
      }}
    >
      <For each={props.reactions}>
        {(reaction) => (
          <span
            class={`call-reaction absolute rounded-full bg-surface/80 ${props.compact ? 'p-1 text-xl' : 'p-2 text-3xl'}`}
            style={{
              ...position(reaction),
              'margin-left': `${((reaction.id * 13) % 33) - 16}px`,
            }}
          >
            {reaction.emoji}
          </span>
        )}
      </For>
    </div>
  );
}
