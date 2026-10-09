import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import Check from '@phosphor/check.svg';
import { Button, Layer } from '@ui';
import { type JSX, Show } from 'solid-js';
import './demo-agent-chip.css';

/** Settled MagicChipView from the app, with local session navigation. */
export function DemoAgentChip(props: {
  agentSessionId: string;
  requester: string;
  request: string;
  markdown: string;
  pullRequest: JSX.Element;
  headerActions: JSX.Element;
  onOpen: () => void;
}) {
  return (
    <div class="demo-cursor-response">
      <div class="demo-cursor-origin">
        from <span>{props.requester}</span>
      </div>
      <div class="demo-cursor-quote">
        <strong>{props.requester}</strong>
        <span>{props.request}</span>
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Open agent session"
        class="my-2 w-full min-w-0 max-w-full text-left"
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        onClick={(event) => {
          event.stopPropagation();
          if (event.target.closest('button, a')) return;
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
        <Layer depth={2}>
          <div
            data-magic-chip-card
            aria-label="Cursor session"
            class="demo-cursor-card"
          >
            <div
              class="flex h-6 min-w-0 items-center gap-2"
              data-magic-chip-header
            >
              <span class="demo-cursor-check" aria-hidden="true">
                <Check class="size-3" />
              </span>
              <span
                class="min-w-0 truncate text-xs font-semibold"
                data-magic-chip-agent
              >
                Cursor Agent
              </span>
              <span class="demo-cursor-model">Auto</span>
              <span class="demo-cursor-status">Done</span>
              <div class="min-w-0 flex-1" />
              {props.headerActions}
              <Button
                variant="outline"
                size="sm"
                noTouchResize
                class="demo-cursor-open"
                label="Open session"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpen();
                }}
              >
                <span class="demo-cursor-open-label">Open session</span>
                <ArrowUpRight class="size-3" />
              </Button>
            </div>
            <div class="demo-cursor-output" data-magic-chip-output-row>
              <Show
                when={props.pullRequest}
                fallback={
                  <p class="demo-cursor-result" data-magic-chip-body>
                    {props.markdown
                      .replace(/[*`]/g, '')
                      .replace(/\s+/g, ' ')
                      .trim()}
                  </p>
                }
              >
                {props.pullRequest}
              </Show>
            </div>
          </div>
        </Layer>
      </div>
    </div>
  );
}
