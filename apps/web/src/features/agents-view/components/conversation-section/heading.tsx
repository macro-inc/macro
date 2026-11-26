import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
export function ConversationSectionHeading(props: {
  title: string;
  count?: number;
  icon?: JSX.Element;
}) {
  return (
    <div class="flex h-8 shrink-0 items-center gap-1.5 px-2 text-xs font-medium text-ink-muted">
      <Show when={props.icon}>
        <span class="mr-0.5 flex w-[18px] shrink-0 items-center justify-end">
          {props.icon}
        </span>
      </Show>
      <span>{props.title}</span>
      <Show when={props.count !== undefined}>
        <span class="text-ink-extra-muted/70 tabular-nums">{props.count}</span>
      </Show>
    </div>
  );
}
