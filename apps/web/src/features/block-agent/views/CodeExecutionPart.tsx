import { fireAndForget } from '@core/util/fireAndForget';
import {
  refetchBackgroundJob,
  useCancelBackgroundJobMutation,
} from '@queries/agent-session/code-execution';
import type {
  ExecutionActivity,
  ExecutionRecord,
  ExecutionStatus,
} from '@service-agent-harness/generated/schemas';
import { isSessionArchived } from '@service-agent-harness/session-archive';
import { useQueryClient } from '@tanstack/solid-query';
import { createEffect, on, Show, Suspense } from 'solid-js';
import { BackgroundJobCard } from '../component/parts/BackgroundJobCard';
import { CodeExecutionToolCall } from '../component/parts/CodeExecutionToolCall';
import type {
  ToolCallCommon,
  ToolCallContext,
  ToolUsePart,
} from '../component/parts/shared';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import { useJobReveal } from '../context/job-reveal';
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
          console.log(
            '[Code mode] ExecuteCode',
            { sessionId, executionId, toolCallId },
            `\n${source}`
          );
        }
      )
    );
  }

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
            : outcome === 'interrupted'
              ? 'Interrupted'
              : 'Failed',
    };
  };

  return (
    <Show
      when={receipt()?.job}
      fallback={
        <CodeExecution
          common={common()}
          context={props.context}
          record={record()}
          error={error()}
          loading={Boolean(executionId()) && query.isPending}
          unavailable={
            query.isError || (query.isSuccess && query.data.source !== source())
          }
        />
      }
    >
      {(job) => (
        <BackgroundJob
          sessionId={props.context.sessionId}
          executionId={receipt()?.executionId ?? ''}
          title={job().title}
          startedAt={job().startedAt}
          status={record()?.status ?? receipt()?.status ?? 'running'}
          neverRan={record()?.job?.neverRan ?? false}
          activity={record()?.activity ?? []}
        />
      )}
    </Show>
  );
}

/**
 * A background job's card. Inside its own session the log announces each
 * state change, so the record is refetched when the job settles rather than
 * on the next poll.
 */
function BackgroundJob(props: {
  sessionId: string;
  executionId: string;
  title: string;
  startedAt: string;
  status: ExecutionStatus;
  neverRan: boolean;
  activity: readonly ExecutionActivity[];
}) {
  const session = useOptionalAgentSession();
  const client = useQueryClient();
  const cancel = useCancelBackgroundJobMutation();
  const announced = () =>
    session?.sessionId() === props.sessionId
      ? session.metadata()?.jobs.find((job) => job.jobId === props.executionId)
          ?.status
      : undefined;
  createEffect(
    on(announced, (status) => {
      if (status && status !== 'running')
        fireAndForget(
          refetchBackgroundJob(client, {
            sessionId: props.sessionId,
            executionId: props.executionId,
          }),
          'agent.background_job.refetch'
        );
    })
  );
  const jobControls = useJobReveal();
  const canCancel = () =>
    Boolean(
      session?.sessionId() === props.sessionId &&
        session.userId() &&
        session.session()?.canEdit &&
        !isSessionArchived(session.session())
    );
  return (
    <BackgroundJobCard
      jobId={props.executionId}
      job={{
        title: props.title,
        startedAt: props.startedAt,
        status: props.status,
        neverRan: props.neverRan,
        activity: props.activity,
      }}
      cancelling={cancel.isPending}
      cancelInMenu={jobControls?.cancelInMenu() ?? false}
      onCancel={
        canCancel()
          ? () =>
              cancel.mutate({
                sessionId: props.sessionId,
                executionId: props.executionId,
              })
          : undefined
      }
    />
  );
}

function CodeExecution(props: {
  common: ToolCallCommon;
  context: ToolCallContext;
  record: ExecutionRecord | undefined;
  error: string | null | undefined;
  loading: boolean;
  unavailable: boolean;
}) {
  return (
    <Suspense
      fallback={
        <p class="text-xs text-ink-extra-muted">Loading workspace activity…</p>
      }
    >
      <CodeExecutionToolCall
        common={props.common}
        context={props.context}
        record={props.record}
        error={props.error}
        loading={props.loading}
        unavailable={props.unavailable}
      />
    </Suspense>
  );
}
