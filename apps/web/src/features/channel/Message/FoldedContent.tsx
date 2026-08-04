import { Tool } from '@core/component/AI/component/tool/Tool';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import Brain from '@phosphor/brain.svg';
import FileText from '@phosphor/file-text.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import ShieldCheck from '@phosphor/shield-check.svg';
import Terminal from '@phosphor/terminal.svg';
import Wrench from '@phosphor/wrench.svg';
import type { FoldedMessageDto } from '@service-storage/generated/schemas/foldedMessageDto';
import type { FoldedMessagePartDto } from '@service-storage/generated/schemas/foldedMessagePartDto';
import type { ToolDetailDto } from '@service-storage/generated/schemas/toolDetailDto';
import { For, type JSX, Show } from 'solid-js';

/** Icon and one-line detail for a tool call, keyed off what the tool did. */
function toolPresentation(detail: ToolDetailDto) {
  switch (detail.kind) {
    case 'terminal':
      return { icon: Terminal, summary: detail.command ?? undefined };
    case 'edit':
      return {
        icon: PencilSimple,
        summary: detail.diffs.map((diff) => diff.path).join(', ') || undefined,
      };
    case 'read':
      return {
        icon: FileText,
        summary: detail.paths.join(', ') || undefined,
      };
    case 'other':
      return { icon: Wrench, summary: undefined };
  }
}

/** What the user chose on a permission request, as a trailing label. */
function permissionOutcomeLabel(
  part: Extract<FoldedMessagePartDto, { kind: 'permission' }>
): string | undefined {
  const outcome = part.outcome;
  if (!outcome) return undefined;
  if (outcome.kind === 'cancelled') return 'Cancelled';
  const chosen = part.options.find((option) => option.id === outcome.optionId);
  return chosen?.name ?? 'Answered';
}

/**
 * The agent's reasoning, styled like the chat's `ThinkingBlock` but always
 * open — this view has no collapsing.
 */
function Thought(props: { text: string }) {
  return (
    <div class="relative text-xs leading-5 text-ink-extra-muted">
      <div class="flex min-h-7 items-center gap-1 py-1">
        <Brain class="size-4 shrink-0" />
        <span>Thought</span>
      </div>
      <div class="pl-5 text-ink-muted whitespace-pre-wrap wrap-break-word">
        {props.text}
      </div>
    </div>
  );
}

// Folded parts are plain immutable query data — a new array arrives on each
// refetch — so rendering them non-reactively in a switch is safe.
function FoldedPart(props: { part: FoldedMessagePartDto }): JSX.Element {
  const part = props.part;
  switch (part.kind) {
    case 'text':
      return (
        <div class="whitespace-pre-wrap wrap-break-word max-w-full text-sm">
          <StaticMarkdown
            markdown={part.text}
            theme={channelTheme}
            target="internal"
          />
        </div>
      );
    case 'thought':
      return <Thought text={part.text} />;
    case 'tool_use': {
      const { icon: Icon, summary } = toolPresentation(part.detail);
      const failed = part.status === 'failed';
      return (
        <Tool.Root muted={failed}>
          <Tool.Row
            icon={Icon}
            trailing={failed ? <span class="text-ink">Failed</span> : undefined}
          >
            <div class="flex min-w-0 items-center gap-1 overflow-hidden">
              <span class="shrink-0 text-ink">{part.label}</span>
              <Show when={summary}>
                {(summary) => (
                  <>
                    <span class="shrink-0 text-ink-placeholder">·</span>
                    <span class="min-w-0 truncate font-mono">{summary()}</span>
                  </>
                )}
              </Show>
            </div>
          </Tool.Row>
        </Tool.Root>
      );
    }
    case 'permission': {
      const outcome = permissionOutcomeLabel(part);
      return (
        <Tool.Root>
          <Tool.Row
            icon={ShieldCheck}
            trailing={
              outcome ? <span class="text-ink">{outcome}</span> : undefined
            }
          >
            <span>Permission requested</span>
          </Tool.Row>
        </Tool.Root>
      );
    }
  }
}

/**
 * The dumb agent viewer: renders a folded agent-session message — prose,
 * reasoning, and tool calls — in place of a placeholder channel message's
 * missing content.
 */
export function FoldedContent(props: { folded: FoldedMessageDto }) {
  return (
    <div class="flex flex-col gap-1 min-w-0">
      <For each={props.folded.parts}>
        {(part) => <FoldedPart part={part} />}
      </For>
    </div>
  );
}
