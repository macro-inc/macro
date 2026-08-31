import { type Component, type JSXElement, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { Button } from './Button';

export type PillButtonTone = 'cta' | 'subtle';

export interface PillButtonProps {
  /** `cta` = primary green action; `subtle` = borderless ink/5 pill. */
  tone?: PillButtonTone;
  /** Optional leading icon, e.g. a plus for "create" actions. */
  icon?: Component<{ class?: string }>;
  onClick: () => void;
  class?: string;
  children: JSXElement;
}

/**
 * Rounded-full pill button shared across empty states and setup cards. Tight
 * vertical padding by design; the leading icon (when present) tightens the left
 * padding so the icon, not the pill edge, sets the rhythm.
 */
export function PillButton(props: PillButtonProps) {
  const subtle = () => props.tone === 'subtle';
  return (
    <Button
      variant={subtle() ? 'outline' : 'cta'}
      size="md"
      class={cn(
        'rounded-full py-1',
        subtle() ? 'bg-ink/5 px-2.5' : props.icon ? 'pl-3 pr-4' : 'px-4',
        props.class
      )}
      onClick={props.onClick}
    >
      <Show when={props.icon}>
        {(icon) => <Dynamic component={icon()} class="size-4" />}
      </Show>
      {props.children}
    </Button>
  );
}
