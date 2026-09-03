/**
 * A Macro user tool: the agent drafted it, the user finishes it after the
 * turn. Rendered with the chat block's own component for the tool — the
 * email composer for `SendEmail`, the event composer for
 * `CreateCalendarEvent`, and their sent / drafted / rejected faces — fed the
 * fold's draft and outcome.
 *
 * The chat components switch on the backend's `UserToolResponse` shape, so
 * the fold's outcome is mapped back onto it here. Editing and sending from a
 * session go through the chat's `callTool` loop today, which a session has no
 * counterpart for yet, so the composer mounts in its disabled state until
 * that API lands.
 */

import { RenderTool } from '@core/component/AI/component/tool/handler';
import type {
  ToolDetail,
  UserToolOutcome,
} from '@service-agent-fold/generated/types';
import { deserializeToolResponse } from '@service-cognition/generated/tools/tool';
import { createMemo, ErrorBoundary, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { FoldedOutput, ToolCard } from '../../ui';
import type { ToolCallCommon, ToolCallContext } from './shared';

type UserToolDetail = Extract<ToolDetail, { kind: 'user_tool' }>;

/**
 * The `UserToolResponse` JSON the chat components switch on, rebuilt from
 * the fold's reading of it. `undefined` for an outcome the chat has no face
 * for (a failed call, an unrecognized response).
 */
function userToolResponse(outcome: UserToolOutcome): unknown {
  return match(outcome)
    .with({ kind: 'pending' }, () => 'PendingUserExecution')
    .with({ kind: 'rejected' }, () => 'Rejected')
    .with({ kind: 'edited' }, () => ({ UserAction: 'userEdited' }))
    .with({ kind: 'sent' }, (sent) => ({
      UserAction: {
        sent: { message_id: sent.messageId, thread_id: sent.threadId },
      },
    }))
    .with({ kind: 'draft' }, (draft) => ({
      UserAction: {
        convertedToDraft: {
          draft_id: draft.draftId,
          ...(draft.threadId ? { thread_id: draft.threadId } : {}),
        },
      },
    }))
    .with({ kind: 'completed' }, (done) => ({ UserAction: done.result }))
    .with({ kind: 'failed' }, { kind: 'unrecognized' }, () => undefined)
    .exhaustive();
}

/** The one-line reading of an outcome, for the fallback card's trailing slot. */
function outcomeLabel(outcome: UserToolOutcome): string {
  return match(outcome)
    .with({ kind: 'pending' }, () => 'Awaiting you')
    .with({ kind: 'edited' }, () => 'Edited')
    .with({ kind: 'sent' }, () => 'Sent')
    .with({ kind: 'draft' }, () => 'Saved as draft')
    .with({ kind: 'completed' }, () => 'Done')
    .with({ kind: 'rejected' }, () => 'Rejected')
    .with({ kind: 'failed' }, () => 'Failed')
    .with({ kind: 'unrecognized' }, () => 'Answered')
    .exhaustive();
}

export function UserToolCall(props: {
  detail: UserToolDetail;
  common: ToolCallCommon;
  context?: ToolCallContext;
}): JSX.Element {
  const response = createMemo(() => userToolResponse(props.detail.outcome));
  // The chat handler renders nothing for a response it cannot read, so a
  // draft whose outcome the chat has no face for keeps the fallback card.
  const chatRenders = createMemo(() => {
    const json = response();
    return (
      json !== undefined &&
      deserializeToolResponse({
        id: props.common.id,
        name: props.common.label,
        json,
      }).isOk()
    );
  });

  return (
    <Show when={chatRenders()} fallback={<FallbackUserToolCall {...props} />}>
      <ErrorBoundary fallback={<FallbackUserToolCall {...props} />}>
        <RenderTool
          tool_id={props.common.id}
          name={props.common.label}
          json={props.detail.input}
          response={{ json: response(), name: props.common.label }}
          chat_id={props.context?.sessionId ?? ''}
          message_id={props.context?.messageId ?? ''}
          part_index={props.context?.partIndex ?? 0}
          isComplete
          renderContext={{
            renderContext: {
              isStreaming: props.context?.inFlight ?? false,
              grouped: false,
            },
          }}
        />
      </ErrorBoundary>
    </Show>
  );
}

/** The draft as JSON with the outcome, for a tool or outcome the chat cannot show. */
function FallbackUserToolCall(props: {
  detail: UserToolDetail;
  common: ToolCallCommon;
}): JSX.Element {
  const body = () =>
    props.detail.outcome.kind === 'failed'
      ? props.detail.outcome.message
      : JSON.stringify(props.detail.input, null, 2);

  return (
    <ToolCard
      title={props.common.label}
      status={props.common.status}
      muted={props.common.muted || props.detail.outcome.kind === 'failed'}
      trailing={
        props.common.trailing ?? (
          <span class="text-ink">{outcomeLabel(props.detail.outcome)}</span>
        )
      }
    >
      <Show when={body()}>{(text) => <FoldedOutput text={text()} />}</Show>
    </ToolCard>
  );
}
