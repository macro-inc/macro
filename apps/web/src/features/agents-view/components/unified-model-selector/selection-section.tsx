import { cn } from '@ui/utils/classname';
import { type JSX, Show } from 'solid-js';

/** A selector section owns its heading, rows, and internal spacing. */
export function ModelSelectionSection(props: {
  title?: string;
  action?: JSX.Element;
  mobile?: boolean;
  bubbles?: boolean;
  children: JSX.Element;
}) {
  return (
    <section
      class={cn(
        'flex flex-col gap-1',
        props.mobile && (props.bubbles ? 'gap-0.5' : 'gap-1.5')
      )}
      role={props.title ? 'group' : undefined}
      aria-label={props.title}
    >
      <Show when={props.title}>
        <div
          class={cn(
            'flex items-center justify-between gap-2 px-2.5 text-xs leading-4 text-ink-extra-muted',
            props.mobile && (props.bubbles ? 'px-2' : 'px-3')
          )}
        >
          <span>{props.title}</span>
          {props.action}
        </div>
      </Show>
      <div class={cn('flex flex-col', props.mobile && 'gap-0.5')}>
        {props.children}
      </div>
    </section>
  );
}
