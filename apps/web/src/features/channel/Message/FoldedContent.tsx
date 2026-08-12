import { Tool } from '@core/component/AI/component/tool/Tool';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import Brain from '@phosphor/brain.svg';
import FileText from '@phosphor/file-text.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import ShieldCheck from '@phosphor/shield-check.svg';
import Terminal from '@phosphor/terminal.svg';
import Wrench from '@phosphor/wrench.svg';
import type {
  FoldedMessage,
  FoldedMessagePart,
  ToolDetail,
} from '@service-agent-fold/generated/types';
import { For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';

/**
 * Icon and one-line detail for a tool call, keyed off what the tool did.
 *
 * `delete`/`move`/`search` share `read`'s path-list summary; `fetch`/`think`
 * share `other`'s bare-icon treatment pending dedicated rendering — see the
 * agent_fold ACP-tool-kind coverage work.
 */
function toolPresentation(detail: ToolDetail) {
  return match(detail)
    .with({ kind: 'terminal' }, (detail) => ({
      icon: Terminal,
      summary: detail.command ?? undefined,
    }))
    .with({ kind: 'edit' }, (detail) => ({
      icon: PencilSimple,
      summary: detail.diffs.map((diff) => diff.path).join(', ') || undefined,
    }))
    .with(
      { kind: 'read' },
      { kind: 'delete' },
      { kind: 'move' },
      { kind: 'search' },
      (detail) => ({
        icon: FileText,
        summary: detail.paths.join(', ') || undefined,
      })
    )
    .with({ kind: 'fetch' }, { kind: 'think' }, { kind: 'other' }, () => ({
      icon: Wrench,
      summary: undefined,
    }))
    .exhaustive();
}

/** What the user chose on a permission request, as a trailing label. */
function permissionOutcomeLabel(
  part: Extract<FoldedMessagePart, { kind: 'permission' }>
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
// refetch — so rendering them non-reactively in a match is safe.
function FoldedPart(props: { part: FoldedMessagePart }): JSX.Element {
  return match(props.part)
    .with({ kind: 'text' }, (part) => (
      <div class="whitespace-pre-wrap wrap-break-word max-w-full text-sm">
        <StaticMarkdown
          markdown={part.text}
          theme={channelTheme}
          target="internal"
        />
      </div>
    ))
    .with({ kind: 'thought' }, (part) => <Thought text={part.text} />)
    .with({ kind: 'tool_use' }, (part) => {
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
    })
    .with({ kind: 'permission' }, (part) => {
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
    })
    .exhaustive();
}

/**
 * The dumb agent viewer: renders a folded agent-session message — prose,
 * reasoning, and tool calls — in place of a placeholder channel message's
 * missing content.
 */
export function FoldedContent(props: { folded: FoldedMessage }) {
  return (
    <div class="flex flex-col gap-1 min-w-0">
      <For each={props.folded.parts}>
        {(part) => <FoldedPart part={part} />}
      </For>
    </div>
  );
}
