/**
 * Routes a folded tool call to its detail component — the chat block's
 * `RenderTool`/handler-map analog (`tool/handler.tsx`).
 *
 * Macro tools route to the chat block's own per-tool components: the agent
 * runs the same `ai_tools` toolset the chat does, so a call whose label is a
 * known tool name and whose raw input parses as that tool's arguments renders
 * with the exact component the chat block would use. Everything else — the
 * coding harness's Bash/Read/Edit, unrecognized tools, calls whose input
 * never arrived — falls back to the fold's kind-based cards, each in its own
 * file.
 */

import { RenderTool } from '@core/component/AI/component/tool/handler';
import type { MessagePart } from '@service-agent-fold/generated/types';
import {
  deserializeToolCall,
  deserializeToolResponse,
} from '@service-cognition/generated/tools/tool';
import { createMemo, ErrorBoundary, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { EditToolCall } from './EditToolCall';
import { OutputToolCall } from './OutputToolCall';
import { PathsToolCall } from './PathsToolCall';
import { SearchToolCall } from './SearchToolCall';
import type { ToolCallCommon } from './shared';
import { TerminalToolCall } from './TerminalToolCall';

type ToolUsePart = Extract<MessagePart, { kind: 'tool_use' }>;

/**
 * Where the part sits in its transcript, for the chat components' render
 * context. The chat block keys its tool components by chat/message/part;
 * the agent block's equivalents are the session, the turn's message, and
 * the part's index. Absent in fixtures and unit tests, where the generic
 * cards (which need none of this) are the layer under test.
 */
export type ToolCallContext = {
  /** The agent session id, standing in for the chat block's chat id. */
  sessionId: string;
  /** A stable per-turn id, standing in for the chat block's message id. */
  messageId: string;
  /** The part's index within its message. */
  partIndex: number;
  /** The turn is still in flight — the chat block's `isStreaming`. */
  inFlight: boolean;
};

/**
 * The Macro tool name a label resolves to, when the call is one the chat
 * renderer can faithfully show. Undefined keeps the part on the generic
 * cards.
 *
 * A call is recognized by evidence, not just its label: the raw input must
 * parse as the named tool's arguments (a coincidental name with different
 * arguments stays generic), and a call that already completed must carry a
 * parseable response — the chat renderer shows a complete call with no
 * parseable response as failed, which would slander a call that succeeded
 * but whose result the log carried in another shape.
 *
 * The label is tried as-is (Macro's own agent names its tools plainly:
 * `ReadContent`) and, failing that, as an `mcp__<server>__<tool>` suffix —
 * how a Claude Code harness names the same tools when it reaches them over
 * MCP.
 */
function resolveMacroTool(part: ToolUsePart): string | undefined {
  if (part.rawInput == null) return undefined;

  const candidates = [part.label];
  const mcp = part.label.match(/^mcp__.+?__(.+)$/);
  if (mcp) candidates.push(mcp[1]);

  for (const name of candidates) {
    const call = deserializeToolCall({
      id: part.id,
      name,
      json: part.rawInput,
    });
    if (call.isErr()) continue;
    if (part.status === 'completed') {
      const response = deserializeToolResponse({
        id: part.id,
        name,
        json: part.rawOutput,
      });
      if (response.isErr()) continue;
    }
    return name;
  }
  return undefined;
}

export function ToolCallPart(props: {
  part: ToolUsePart;
  context?: ToolCallContext;
}): JSX.Element {
  const macroTool = createMemo(() => resolveMacroTool(props.part));

  return (
    <Show
      when={macroTool()}
      fallback={<GenericToolCall part={props.part} />}
      keyed
    >
      {(name) => (
        // A handful of chat tool components assume chat-only context (the
        // email/calendar compose flows resume a chat stream); if one throws
        // here, fall back to the generic card rather than losing the row.
        <ErrorBoundary fallback={<GenericToolCall part={props.part} />}>
          <MacroToolCall
            name={name}
            part={props.part}
            context={props.context}
          />
        </ErrorBoundary>
      )}
    </Show>
  );
}

/**
 * The chat block's tool renderer, fed from the fold: label is the tool name,
 * `rawInput` the call arguments, `rawOutput` the response. A failed call or
 * a response that never parsed renders exactly as it does in the chat —
 * `RenderTool` treats a complete call with no parseable response as failed.
 */
function MacroToolCall(props: {
  /** The resolved Macro tool name — the label, MCP prefix stripped. */
  name: string;
  part: ToolUsePart;
  context?: ToolCallContext;
}): JSX.Element {
  const response = () =>
    props.part.rawOutput == null
      ? undefined
      : { json: props.part.rawOutput, name: props.name };

  return (
    <RenderTool
      tool_id={props.part.id}
      name={props.name}
      json={props.part.rawInput}
      response={response()}
      chat_id={props.context?.sessionId ?? ''}
      message_id={props.context?.messageId ?? ''}
      part_index={props.context?.partIndex ?? 0}
      isComplete={
        props.part.status === 'completed' || props.part.status === 'failed'
      }
      renderContext={{
        renderContext: {
          isStreaming: props.context?.inFlight ?? false,
          grouped: false,
        },
      }}
    />
  );
}

/** The fold's kind-based cards, keyed off the closed `ToolDetail` union. */
function GenericToolCall(props: { part: ToolUsePart }): JSX.Element {
  const failed = () => props.part.status === 'failed';
  // The chat block's failed-tool treatment: the same row, faded, with a quiet
  // trailing label — not a separate error card.
  const common = (): ToolCallCommon => ({
    label: props.part.label,
    status: props.part.status,
    muted: failed(),
    trailing: failed() ? <span class="text-ink">Failed</span> : undefined,
  });

  return match(props.part.detail)
    .with({ kind: 'terminal' }, (detail) => (
      <TerminalToolCall detail={detail} common={common()} />
    ))
    .with({ kind: 'edit' }, (detail) => (
      <EditToolCall detail={detail} common={common()} />
    ))
    .with({ kind: 'read' }, { kind: 'delete' }, { kind: 'move' }, (detail) => (
      <PathsToolCall detail={detail} common={common()} />
    ))
    .with({ kind: 'search' }, (detail) => (
      <SearchToolCall detail={detail} common={common()} />
    ))
    .with({ kind: 'fetch' }, { kind: 'think' }, { kind: 'other' }, (detail) => (
      <OutputToolCall detail={detail} common={common()} />
    ))
    .exhaustive();
}
