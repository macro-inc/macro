import { type Component, type JSXElement, Show, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';

export type PillButtonTone = 'cta' | 'subtle';

export interface PillButtonProps
  extends Omit<ButtonProps, 'variant' | 'size' | 'children'> {
  /** `cta` uses stronger ink; both tones use the shared flat action frame. */
  tone?: PillButtonTone;
  /** Optional leading icon, e.g. a plus for "create" actions. */
  icon?: Component<{ class?: string }>;
  class?: string;
  children: JSXElement;
}

/**
 * Rounded-full button shared across empty states and setup cards. Tight
 * vertical padding by design; the leading icon (when present) tightens the left
 * padding so the icon, not the pill edge, sets the rhythm.
 */
export function PillButton(props: PillButtonProps) {
  const [local, rest] = splitProps(props, [
    'tone',
    'icon',
    'class',
    'children',
  ]);
  const subtle = () => local.tone === 'subtle';
  return (
    <Button
      {...rest}
      variant={subtle() ? 'secondary' : 'primary'}
      size="md"
      class={cn(
        'py-1',
        subtle() ? 'px-2.5' : local.icon ? 'pl-3 pr-4' : 'px-4',
        local.class
      )}
    >
      <Show when={local.icon}>
        {(icon) => <Dynamic component={icon()} class="size-4" />}
      </Show>
      {local.children}
    </Button>
  );
}
