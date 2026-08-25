/**
 * Error card for a failed tool call: a red-edged collapsible row whose header
 * is "Tool · Subtitle" and whose body is the rest of the error, with a
 * copy-error button.
 *
 * Port of opencode's tool-error-card (v2 layout + v1 error parsing and copy
 * button) — github.com/sst/opencode, MIT © 2025 opencode — adapted to Macro
 * tokens and Tailwind.
 */

import { Collapsible } from '@kobalte/core/collapsible';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import Copy from '@phosphor/copy.svg';
import Prohibit from '@phosphor/prohibit.svg';
import { Button } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';

/** Display names for well-known tool ids (from opencode's v1 card). */
const TOOL_NAMES: Record<string, string> = {
  read: 'Read',
  list: 'List',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Task',
  webfetch: 'Webfetch',
  websearch: 'Web Search',
  bash: 'Shell',
  shell: 'Shell',
  patch: 'Patch',
  apply_patch: 'Patch',
  question: 'Questions',
};

export interface ToolErrorCardProps {
  /** Tool id the error came from, e.g. "bash". */
  tool: string;
  /** Raw error text, e.g. "Error: bash command failed: exit 1". */
  error: string;
  /** Controlled expanded state; leave unset for uncontrolled. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ToolErrorCard(props: ToolErrorCardProps) {
  const [copied, setCopied] = createSignal(false);

  const title = createMemo(() => TOOL_NAMES[props.tool] ?? props.tool);

  /** Error text minus any leading "Error: ". */
  const cleaned = createMemo(() =>
    props.error.replace(/^Error:\s*/, '').trim()
  );

  /** `cleaned` minus a leading "<tool> " echo of the tool's own name. */
  const tail = createMemo(() => {
    const value = cleaned();
    const prefix = `${props.tool} `;
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
  });

  /** First "head: rest" segment of the error, capitalized; "Failed" if none. */
  const subtitle = createMemo(() => {
    const parts = tail().split(': ');
    if (parts.length <= 1) return 'Failed';
    const head = (parts[0] ?? '').trim();
    if (!head) return 'Failed';
    return head[0].toUpperCase() + head.slice(1);
  });

  /** Everything after the subtitle; the whole error when there's no split. */
  const body = createMemo(() => {
    const parts = tail().split(': ');
    if (parts.length <= 1) return cleaned();
    return parts.slice(1).join(': ').trim() || cleaned();
  });

  const copy = async () => {
    const text = cleaned();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  return (
    <Collapsible
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={props.onOpenChange}
      class="flex w-full min-w-0 flex-col border-l-2 border-failure pl-2.5 text-xs leading-5"
    >
      <Collapsible.Trigger class="group flex min-h-6 w-full min-w-0 items-center gap-2 rounded-xs py-0.5 text-left">
        <Prohibit class="size-4 shrink-0 text-failure" />
        <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span class="shrink-0 font-medium text-ink">{title()}</span>
          <span class="shrink-0 text-ink-placeholder" aria-hidden="true">
            ·
          </span>
          <span class="min-w-0 truncate text-ink-muted">{subtitle()}</span>
          <CaretRight class="size-3.5 shrink-0 text-ink-extra-muted transition-transform group-data-expanded:rotate-90" />
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content class="min-w-0 data-closed:hidden">
        <div class="flex items-start gap-2 pt-1 pl-6">
          <div class="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word text-ink-extra-muted">
            {body()}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            noTouchResize
            class="shrink-0 px-1 text-ink-extra-muted hover:text-ink-muted"
            aria-label={copied() ? 'Copied' : 'Copy error'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              void copy();
            }}
          >
            <Show when={copied()} fallback={<Copy class="size-3.5" />}>
              <Check class="size-3.5 text-success" />
            </Show>
          </Button>
        </div>
      </Collapsible.Content>
    </Collapsible>
  );
}
