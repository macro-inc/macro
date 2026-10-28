import type { JSX } from 'solid-js';

/** Agent results give the task title its own line, at every container width. */
export function TaskResultRow(props: {
  title: string;
  icon: JSX.Element;
  metadata: JSX.Element;
  timestamp: JSX.Element;
  onOpen: () => void;
}) {
  return (
    <div class="mx-1 flex min-w-0 items-start gap-2 rounded-xl px-2 py-2 not-touch:hover:bg-list-hover focus-within:bg-list-hover">
      <span class="mt-0.5 size-4 shrink-0">{props.icon}</span>
      <div class="min-w-0 flex-1">
        <button
          type="button"
          class="block w-full touch:min-h-[44px] text-left text-sm font-medium whitespace-normal [overflow-wrap:anywhere]"
          onClick={props.onOpen}
        >
          {props.title}
        </button>
        <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-extra-muted">
          <div class="min-w-0 [&>div]:flex-wrap">{props.metadata}</div>
          {props.timestamp}
        </div>
      </div>
    </div>
  );
}
