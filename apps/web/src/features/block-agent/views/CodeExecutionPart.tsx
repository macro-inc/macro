import {
  BlockedPermissionsNotice,
  describeGatedThings,
} from '@app/features/agent-permissions';
import { t } from '@app/lib/i18n';
import { createEffect, Match, on, Suspense, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { CodeExecutionToolCall } from '../component/parts/CodeExecutionToolCall';
import type {
  ToolCallCommon,
  ToolCallContext,
  ToolUsePart,
} from '../component/parts/shared';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import { parseExecutionPermission } from '../state/permission-approval';
import { ToolCard } from '../ui';
import { useCodeExecutionRecord } from './code-execution-record';

/** Production wiring; the result components receive only data and context. */
export function CodeExecutionPart(props: {
  part: ToolUsePart;
  common: ToolCallCommon;
  context: ToolCallContext;
}) {
  const {
    receipt,
    requestedExecutionId,
    executionId,
    query,
    source,
    program,
    isThisProgram,
    record,
    error,
  } = useCodeExecutionRecord(
    () => props.part,
    () => props.context.sessionId,
    () => props.context.inFlight
  );

  if (import.meta.env.DEV) {
    let loggedCall: string | undefined;
    // Log complete dispatched input, not the model's pending argument chunks.
    createEffect(
      on(
        [
          () => props.part.status,
          () => props.context.sessionId,
          () => props.common.id,
          requestedExecutionId,
          source,
        ],
        ([status, sessionId, toolCallId, executionId, source]) => {
          if (status === 'pending' || !executionId || source === undefined)
            return;
          const call = `${sessionId}:${toolCallId}`;
          if (loggedCall === call) return;
          loggedCall = call;
          const module = program()?.module;
          console.log(
            '[Code mode] ExecuteCode',
            { sessionId, executionId, toolCallId },
            module ? `\n${source}\n// module\n${module}` : `\n${source}`
          );
        }
      )
    );
  }

  const session = useOptionalAgentSession();
  const agentName = () =>
    session?.bot()?.name ?? t('agentPermissionsChat.theAgent');
  // A program its permissions stopped before it ran: the saved record's
  // account, else the receipt's (the record may not have loaded yet).
  const permission = () =>
    parseExecutionPermission(record()?.permission) ??
    parseExecutionPermission(receipt()?.permission);
  const blocked = () => {
    const current = permission();
    return current?.outcome === 'blocked' ? current : undefined;
  };
  const declined = () => {
    const current = permission();
    return current?.outcome === 'declined' ? current : undefined;
  };

  const status = () => record()?.status ?? receipt()?.status;
  const common = (): ToolCallCommon => {
    const outcome = status();
    if (!outcome || outcome === 'succeeded' || outcome === 'running')
      return props.common;
    return {
      ...props.common,
      status: 'failed',
      muted: true,
      trailing:
        outcome === 'cancelled'
          ? 'Cancelled'
          : outcome === 'timed_out'
            ? 'Timed out'
            : 'Failed',
    };
  };

  return (
    <Switch>
      <Match when={blocked()}>
        {(current) => (
          <BlockedPermissionsNotice
            sessionId={props.context.sessionId}
            agentName={agentName()}
            operations={current().operations}
          />
        )}
      </Match>
      <Match when={declined()}>
        {(current) => (
          <ToolCard
            title={t('agentPermissionsChat.didntRun', {
              things: describeGatedThings(current().operations),
            })}
            status="completed"
            muted
            trailing={match(current().status)
              .with('denied', () => t('agentPermissionsChat.declined'))
              .with('cancelled', () => t('agentPermissionsChat.cancelled'))
              .with('expired', () =>
                t('agentPermissionsChat.notApprovedInTime')
              )
              .exhaustive()}
          />
        )}
      </Match>
      <Match when={true}>
        <Suspense
          fallback={
            <p class="text-xs text-ink-extra-muted">
              Loading workspace activity…
            </p>
          }
        >
          <CodeExecutionToolCall
            common={common()}
            context={props.context}
            record={record()}
            error={error()}
            loading={Boolean(executionId()) && query.isPending}
            unavailable={query.isError || (query.isSuccess && !isThisProgram())}
          />
        </Suspense>
      </Match>
    </Switch>
  );
}
