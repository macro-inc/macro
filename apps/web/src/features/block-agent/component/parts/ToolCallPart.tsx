/**
 * Routes a folded tool call to its detail component — the chat block's
 * `RenderTool`/handler-map analog (`tool/handler.tsx`).
 *
 * The fold has already decided what every call is: a coding-harness tool by
 * kind (terminal, edit, read, ...), a Macro tool by name, a user tool the
 * user finishes, or a delegated subagent. This is a pure match over that
 * closed vocabulary — nothing here reads ACP, parses raw JSON, or guesses a
 * tool from its title.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import { EditToolCall } from './EditToolCall';
import { MacroToolCall } from './MacroToolCall';
import { OutputToolCall } from './OutputToolCall';
import { PathsToolCall } from './PathsToolCall';
import { SearchToolCall } from './SearchToolCall';
import { SubagentToolCall } from './SubagentToolCall';
import { type ToolCallCommon, type ToolCallContext, toolLabel } from './shared';
import { TerminalToolCall } from './TerminalToolCall';
import { UserToolCall } from './UserToolCall';

type ToolUsePart = Extract<MessagePart, { kind: 'tool_use' }>;

export function ToolCallPart(props: {
  part: ToolUsePart;
  /** Where the part sits, for the chat components Macro tools render with. */
  context?: ToolCallContext;
}): JSX.Element {
  const failed = () => props.part.status === 'failed';
  // The chat block's failed-tool treatment: the same row, faded, with a quiet
  // trailing label — not a separate error card.
  const common = (): ToolCallCommon => ({
    id: props.part.id,
    label: toolLabel(props.part.name),
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
    .with({ kind: 'macro' }, (detail) => (
      <MacroToolCall
        detail={detail}
        common={common()}
        context={props.context}
      />
    ))
    .with({ kind: 'user_tool' }, (detail) => (
      <UserToolCall detail={detail} common={common()} context={props.context} />
    ))
    .with({ kind: 'subagent' }, (detail) => (
      <SubagentToolCall
        detail={detail}
        common={common()}
        context={props.context}
      />
    ))
    .exhaustive();
}
