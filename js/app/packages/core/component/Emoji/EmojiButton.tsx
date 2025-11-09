import type { Component } from 'solid-js';
import { renderEmoji } from './EmojiSelector';
import type { SimpleEmoji } from './emojis';

interface EmojiButtonProps {
  emoji: SimpleEmoji;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
} as const;

export const EmojiButton: Component<EmojiButtonProps> = (props) => {
  return (
    <span
      class={`inline-flex items-center justify-center ${sizeClasses[props.size ?? 'md']}`}
    >
      {renderEmoji(props.emoji?.emoji)}
    </span>
  );
};
