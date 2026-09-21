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

import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import { settledToolStatus } from '../../ui';
import { EditToolCall } from './EditToolCall';
import { ExchangeToolCall } from './ExchangeToolCall';
import { MacroToolCall } from './MacroToolCall';
import { OutputToolCall } from './OutputToolCall';
import { PathsToolCall } from './PathsToolCall';
import { SearchToolCall } from './SearchToolCall';
import { SubagentToolCall } from './SubagentToolCall';
import {
  type ToolCallCommon,
  type ToolCallContext,
  type ToolUsePart,
  toolLabel,
  toolServer,
} from './shared';
import { TerminalToolCall } from './TerminalToolCall';
import { UserToolCall } from './UserToolCall';

export function ToolCallPart(props: {
  part: ToolUsePart;
  /** Where the part sits, for the chat components Macro tools render with. */
  context?: ToolCallContext;
}): JSX.Element {
  const failed = () => props.part.status === 'failed';
  // A call the log still has running once its turn is over is not running
  // (see `settledToolStatus`). Without a turn to place it in there is no
  // live turn either, so it settles too.
  const status = () =>
    settledToolStatus(props.part.status, props.context?.inFlight ?? false);
  // The chat block's failed-tool treatment: the same row, faded, with a quiet
  // trailing label — not a separate error card.
  const common = (): ToolCallCommon => ({
    id: props.part.id,
    label: toolLabel(props.part.name),
    server: toolServer(props.part.name),
    status: status(),
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
    .with({ kind: 'fetch' }, { kind: 'think' }, (detail) => (
      <OutputToolCall detail={detail} common={common()} />
    ))
    .with({ kind: 'other' }, (detail) => (
      <ExchangeToolCall detail={detail} common={common()} />
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
