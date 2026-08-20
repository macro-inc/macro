/**
 * Routes a folded tool call to its detail component — the chat block's
 * `RenderTool`/handler-map analog (`tool/handler.tsx`), keyed off the fold's
 * closed `ToolDetail` union instead of tool names. Routing only: every card
 * lives in its own file.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import { EditToolCall } from './EditToolCall';
import { OutputToolCall } from './OutputToolCall';
import { PathsToolCall } from './PathsToolCall';
import { SearchToolCall } from './SearchToolCall';
import type { ToolCallCommon } from './shared';
import { TerminalToolCall } from './TerminalToolCall';

export function ToolCallPart(props: {
  part: Extract<MessagePart, { kind: 'tool_use' }>;
}): JSX.Element {
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
