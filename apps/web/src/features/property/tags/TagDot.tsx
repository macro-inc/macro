import { cn } from '@ui';
import { DEFAULT_TAG_COLOR } from './tagColors';

export function TagDot(props: { color?: string; class?: string }) {
  return (
    <span
      class={cn('size-2.5 shrink-0 rounded-full', props.class)}
      style={{ 'background-color': props.color ?? DEFAULT_TAG_COLOR }}
    />
  );
}
