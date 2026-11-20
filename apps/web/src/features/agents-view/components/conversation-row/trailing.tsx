import { children, type JSX, Show } from 'solid-js';

export function ConversationRowTrailing(props: {
  age: string;
  children?: JSX.Element;
}) {
  const content = children(() => props.children);
  return (
    <span
      class="conversation-trailing pointer-events-none ml-auto flex size-4 shrink-0 items-center justify-end"
      data-has-code={content.toArray().length ? '' : undefined}
    >
      <span class="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center rounded-r-lg bg-[linear-gradient(to_right,transparent,var(--conversation-row-surface)_2rem)] pl-8 pr-(--sidebar-item-inset) text-xs text-ink-extra-muted tabular-nums opacity-0 transition-opacity duration-120 ease-out group-hover/conversation:opacity-100 group-focus-within/conversation:opacity-100 motion-reduce:transition-none">
        {props.age}
      </span>
      <Show when={content.toArray().length}>
        <span class="conversation-code pointer-events-auto relative flex size-4 items-center justify-center">
          {content()}
        </span>
      </Show>
    </span>
  );
}
