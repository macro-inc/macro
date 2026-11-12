/**
 * A run of tool calls and thoughts as one row that opens to them. While the
 * turn is in the run, the row is its live line: the working dots and the
 * step the agent is on, or the session's own status line over them. Once
 * the run is over it settles to "Used N tools", with any failures counted.
 * It opens only when the reader asks, and then lists every call in full.
 *
 * Shaped like `Thought` rather than `ToolCard`: a bare caret row, no surface,
 * because the cards themselves appear once it opens.
 */

import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, createUniqueId, type JSX, Show } from 'solid-js';
import { ActivityLine, type ActivityLineStep } from './ActivityLine';
import { DisclosureCaret } from './DisclosureCaret';

export interface ToolGroupProps {
  /** The steps the run shows when open. */
  count: number;
  /** How many of them failed; the settled row says so. */
  failed?: number;
  /**
   * The turn is in this run: the row is its live line over these steps. A
   * turn has at most one live run.
   */
  live?: boolean;
  steps?: readonly ActivityLineStep[];
  /** The session's live status line, which stands for the steps it names. */
  summary?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** One element per call or thought, each at least one compact row tall. */
  children: JSX.Element;
}

export function ToolGroup(props: ToolGroupProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    props.defaultOpen ?? false
  );
  const expanded = () => props.open ?? uncontrolledOpen();
  const setExpanded = (open: boolean) => {
    setUncontrolledOpen(open);
    props.onOpenChange?.(open);
  };
  const contentId = createUniqueId();
  const failed = () => props.failed ?? 0;

  return (
    <div class="min-w-0 text-sm leading-6 text-ink-extra-muted">
      <button
        type="button"
        aria-expanded={expanded()}
        aria-controls={contentId}
        class="group flex min-h-8 min-w-0 max-w-full items-center gap-2 py-1 text-left text-ink-extra-muted not-touch:hover:text-ink-muted"
        onClick={() => setExpanded(!expanded())}
      >
        <Show
          when={props.live}
          fallback={
            <span class="min-w-0 truncate">
              {`Used ${props.count} ${props.count === 1 ? 'tool' : 'tools'}`}
              <Show when={failed() > 0}>
                <span class="text-failure">{` · ${failed()} failed`}</span>
              </Show>
            </span>
          }
        >
          <ActivityLine
            class="my-0 shrink"
            steps={props.steps ?? []}
            summary={props.summary}
          />
        </Show>
        <DisclosureCaret open={expanded()} />
      </button>
      <CollapseTransition open={expanded()}>
        <div
          id={contentId}
          role="region"
          aria-label="Tool calls"
          class="flex min-w-0 flex-col"
        >
          {props.children}
        </div>
      </CollapseTransition>
    </div>
  );
}
