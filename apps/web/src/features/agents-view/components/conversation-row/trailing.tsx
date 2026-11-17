import { children, type JSX, Show } from 'solid-js';

export function ConversationRowTrailing(props: {
  age: string;
  previewOpen?: boolean;
  children?: JSX.Element;
}) {
  const content = children(() => props.children);
  return (
    <span
      class="conversation-trailing relative ml-auto grid h-5 min-w-4 shrink-0 items-center justify-items-end"
      data-has-code={content.toArray().length ? '' : undefined}
      data-preview-open={props.previewOpen ? '' : undefined}
    >
      <span class="conversation-age pointer-events-none col-start-1 row-start-1 text-xs text-ink-extra-muted tabular-nums">
        {props.age}
      </span>
      <Show when={content.toArray().length}>
        <span class="conversation-code col-start-1 row-start-1 items-center justify-center">
          {content()}
        </span>
      </Show>
    </span>
  );
}
