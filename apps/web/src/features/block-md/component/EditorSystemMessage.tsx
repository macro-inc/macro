import InfoIcon from '@phosphor/info.svg';
import WarningIcon from '@phosphor/warning.svg';
import WarningCircleIcon from '@phosphor/warning-circle.svg';
import { cn, createVariants, type VariantProps } from '@ui';
import { type ComponentProps, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export const editorSystemMessageVariants = createVariants(
  'pointer-events-none flex w-full items-start gap-2 rounded-lg border p-3 text-sm',
  {
    variant: {
      base: 'border-edge-muted bg-surface-2 text-ink-muted',
      error: 'border-failure/30 bg-failure-bg text-failure-ink',
      warning: 'border-alert/30 bg-alert-bg text-alert-ink',
    },
  },
  {
    variant: 'base',
  }
);

export type EditorSystemMessageVariantProps = VariantProps<
  typeof editorSystemMessageVariants
>;

export type EditorSystemMessageProps = ComponentProps<'div'> &
  EditorSystemMessageVariantProps;

const icons = {
  base: InfoIcon,
  error: WarningCircleIcon,
  warning: WarningIcon,
} as const;

export function EditorSystemMessage(props: EditorSystemMessageProps) {
  const [local, others] = splitProps(props, ['variant', 'class', 'children']);
  const variant = () => local.variant ?? 'base';

  return (
    <div
      data-slot="editor-system-message"
      data-variant={variant()}
      role={variant() === 'error' ? 'alert' : 'status'}
      class={cn(
        editorSystemMessageVariants({ variant: variant() }),
        local.class
      )}
      {...others}
    >
      <span class="flex h-lh shrink-0 items-center" aria-hidden="true">
        <Dynamic component={icons[variant()]} class="size-4" />
      </span>
      <div class="min-w-0 flex-1">{local.children}</div>
    </div>
  );
}
