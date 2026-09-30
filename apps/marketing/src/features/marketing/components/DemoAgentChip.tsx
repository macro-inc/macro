import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import Check from '@phosphor/check.svg';
import { Layer } from '@ui';
import type { JSX } from 'solid-js';

/** Standalone copy of the settled agent preview at the website's design freeze. */
export function DemoAgentChip(props: {
  agentSessionId: string;
  markdown: string;
  pullRequest: JSX.Element;
  headerActions: JSX.Element;
  onOpen: () => void;
}) {
  return (
    <Layer depth={2}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Open agent session"
        class="my-2 flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-md border border-edge-muted bg-surface text-left hover:border-edge"
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        onClick={(event) => {
          event.stopPropagation();
          const control = event.target.closest('button, a, [role="button"]');
          if (control && control !== event.currentTarget) return;
          props.onOpen();
        }}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            (event.key !== 'Enter' && event.key !== ' ')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          props.onOpen();
        }}
      >
        <Layer offset={1}>
          <div
            class="flex h-7 items-center gap-2 border-b border-edge-muted bg-surface pr-1 pl-2.5 text-xs leading-5 text-ink-muted"
            data-magic-chip-header
          >
            <span
              class="grid size-3.5 shrink-0 place-items-center rounded-full bg-green text-surface"
              data-magic-chip-dot="done"
              aria-hidden="true"
            >
              <Check class="size-2.5" />
            </span>
            <span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              <span
                class="shrink-0 font-semibold text-ink"
                title="Auto"
                data-magic-chip-agent
              >
                Cursor Agent
              </span>
              <span aria-hidden="true" class="shrink-0 text-ink-placeholder">
                ·
              </span>
              <span class="shrink-0 text-ink-muted">Done</span>
            </span>
            <button
              type="button"
              class="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-edge bg-surface px-2 font-medium text-ink-muted text-xs hover:bg-active hover:text-ink"
              onClick={props.onOpen}
            >
              View session
              <ArrowUpRight class="size-3" />
            </button>
            <div class="flex min-w-0 max-w-[40%] justify-end overflow-hidden">
              {props.pullRequest}
            </div>
            {props.headerActions}
          </div>
        </Layer>
        <div
          class="flex h-8 min-w-0 items-center gap-2 pr-2.5 pl-2.5 text-ink text-sm leading-5"
          data-magic-chip-answer
        >
          <span class="min-w-0 flex-1 truncate" data-magic-chip-line>
            {props.markdown.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim()}
          </span>
        </div>
      </div>
    </Layer>
  );
}
