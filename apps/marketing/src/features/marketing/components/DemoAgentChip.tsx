import ArrowUpRight from '@icon/system/regular/arrow-up-right.svg';
import Check from '@icon/system/regular/check.svg';
import { Button, Layer } from '@ui';
import { type JSX, Show } from 'solid-js';
import './demo-agent-chip.css';

/** Frozen MagicChipView from the app, with optional local session navigation. */
export function DemoAgentChip(props: {
  agentSessionId: string;
  requester: string;
  showRequest?: boolean;
  request: string;
  markdown: string;
  pullRequest?: JSX.Element;
  headerActions?: JSX.Element;
  running?: boolean;
  onOpen?: () => void;
}) {
  return (
    <div class="demo-cursor-response">
      <Show when={props.showRequest !== false}>
        <div class="demo-cursor-origin">
          from <span>{props.requester}</span>
        </div>
        <div class="demo-cursor-quote">
          <strong>{props.requester}</strong>
          <span>{props.request}</span>
        </div>
      </Show>
      <div
        role={props.onOpen ? 'button' : undefined}
        tabIndex={props.onOpen ? 0 : undefined}
        aria-label={props.onOpen ? 'Open agent session' : undefined}
        class="my-2 w-full min-w-0 max-w-full text-left"
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        onClick={(event) => {
          if (!props.onOpen || event.target.closest('button, a')) return;
          event.stopPropagation();
          props.onOpen();
        }}
        onKeyDown={(event) => {
          if (
            !props.onOpen ||
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
              <Show
                when={props.running}
                fallback={
                  <span class="demo-cursor-check" aria-hidden="true">
                    <Check class="size-3" />
                  </span>
                }
              >
                <span class="demo-cursor-running" aria-hidden="true" />
              </Show>
              <span
                class="min-w-0 truncate text-xs font-medium"
                data-magic-chip-agent
              >
                Cursor Agent
              </span>
              <span class="demo-cursor-model">Auto</span>
              <span
                class="demo-cursor-status"
                data-running={props.running || undefined}
              >
                {props.running ? 'Running' : 'Done'}
              </span>
              <div class="min-w-0 flex-1" />
              {props.headerActions}
              <Show when={props.onOpen}>
                <Button
                  variant="outline"
                  size="sm"
                  noTouchResize
                  class="demo-cursor-open"
                  label="Open session"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpen?.();
                  }}
                >
                  <span class="demo-cursor-open-label">Open session</span>
                  <ArrowUpRight class="size-3" />
                </Button>
              </Show>
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
