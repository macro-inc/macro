/**
 * Routes a folded tool call to its detail component — the chat block's
 * `RenderTool`/handler-map analog (`tool/handler.tsx`).
 *
 * The fold has already decided what every call is: a coding-harness tool by
 * kind (terminal, edit, read, ...), a Macro tool by name, a user tool the
 * user finishes, or a delegated subagent. Generic calls explicitly addressed
 * to Macro's MCP server may also use a registered renderer, after that renderer
 * validates the payload. External servers never select Macro UI by name alone.
 */

import { hasToolRenderer } from '@core/component/AI/component/tool/handler';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { rendersOwnView } from '../../state/tool-groups';
import { settledToolStatus } from '../../ui';
import { DisplayResultsToolCall } from './DisplayResultsToolCall';
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
    trailing: failed()
      ? 'Failed'
      : (props.part.status === 'pending' || props.part.status === 'running') &&
          status() === 'completed'
        ? 'Stopped'
        : undefined,
  });

  // Non-keyed matches preserve the disclosure when a streamed update replaces
  // its detail object; each child receives the current detail through an accessor.
  return (
    <Switch>
      <Match when={rendersOwnView(props.part)}>
        <DisplayResultsToolCall
          input={
            'input' in props.part.detail ? props.part.detail.input : undefined
          }
          error={
            'error' in props.part.detail ? props.part.detail.error : undefined
          }
          common={common()}
        />
      </Match>
      <Match when={props.part.detail.kind === 'terminal' && props.part.detail}>
        {(detail) => <TerminalToolCall detail={detail()} common={common()} />}
      </Match>
      <Match when={props.part.detail.kind === 'edit' && props.part.detail}>
        {(detail) => <EditToolCall detail={detail()} common={common()} />}
      </Match>
      <Match
        when={
          (props.part.detail.kind === 'read' ||
            props.part.detail.kind === 'delete' ||
            props.part.detail.kind === 'move') &&
          props.part.detail
        }
      >
        {(detail) => <PathsToolCall detail={detail()} common={common()} />}
      </Match>
      <Match when={props.part.detail.kind === 'search' && props.part.detail}>
        {(detail) => <SearchToolCall detail={detail()} common={common()} />}
      </Match>
      <Match
        when={
          (props.part.detail.kind === 'fetch' ||
            props.part.detail.kind === 'think') &&
          props.part.detail
        }
      >
        {(detail) => <OutputToolCall detail={detail()} common={common()} />}
      </Match>
      <Match when={props.part.detail.kind === 'other' && props.part.detail}>
        {(detail) => (
          <Show
            when={
              props.part.name.kind === 'mcp' &&
              props.part.name.server === 'macro' &&
              hasToolRenderer(props.part.name.tool)
            }
            fallback={<ExchangeToolCall detail={detail()} common={common()} />}
          >
            <MacroToolCall
              detail={{
                kind: 'macro',
                input: detail().input,
                output: detail().result ?? detail().output,
                error: detail().error,
              }}
              common={common()}
              context={props.context}
            />
          </Show>
        )}
      </Match>
      <Match when={props.part.detail.kind === 'macro' && props.part.detail}>
        {(detail) => (
          <MacroToolCall
            detail={detail()}
            common={common()}
            context={props.context}
          />
        )}
      </Match>
      <Match when={props.part.detail.kind === 'user_tool' && props.part.detail}>
        {(detail) => (
          <UserToolCall
            detail={detail()}
            common={common()}
            context={props.context}
          />
        )}
      </Match>
      <Match when={props.part.detail.kind === 'subagent' && props.part.detail}>
        {(detail) => (
          <SubagentToolCall
            detail={detail()}
            common={common()}
            context={props.context}
          />
        )}
      </Match>
    </Switch>
  );
}
