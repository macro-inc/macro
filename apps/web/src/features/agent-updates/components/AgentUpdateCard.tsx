import { LiveQuestionCard } from '@app/features/agent-interactions/components/LiveElicitation';
import { fireAndForget } from '@core/util/fireAndForget';
import type { PendingInteraction } from '@service-agent-fold/generated/types';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { compactAge } from '../../agents-view/core/format-age';
import type { AgentUpdate } from '../core/agent-update';

export type UpdateAnswer = {
  optionId?: string;
  elicitation?: ElicitationAnswer;
  approval?: 'approve' | 'approve_and_remember' | 'deny';
};

function RequestActions(props: {
  request: PendingInteraction;
  answering: boolean;
  onAnswer: (answer: UpdateAnswer) => Promise<boolean>;
}) {
  const send = (answer: UpdateAnswer) =>
    fireAndForget(props.onAnswer(answer), 'agent-updates');
  return (
    <div class="mt-2 flex flex-wrap items-center gap-1 pl-4 touch:[&_button]:min-h-11">
      {match(props.request)
        .with({ kind: 'permission' }, (permission) => (
          <For each={permission.options}>
            {(option) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                class="touch:min-h-11"
                disabled={props.answering}
                onClick={() => send({ optionId: option.id })}
              >
                {option.name}
              </Button>
            )}
          </For>
        ))
        .with({ kind: 'tool_approval' }, () => (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="touch:min-h-11"
              disabled={props.answering}
              onClick={() => send({ approval: 'approve' })}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="touch:min-h-11"
              disabled={props.answering}
              onClick={() => send({ approval: 'approve_and_remember' })}
            >
              Always allow
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="touch:min-h-11"
              disabled={props.answering}
              onClick={() => send({ approval: 'deny' })}
            >
              Deny
            </Button>
          </>
        ))
        .with({ kind: 'elicitation' }, (elicitation) => (
          <div class="w-full">
            <LiveQuestionCard
              request={
                elicitation.request.kind === 'user_tool'
                  ? { kind: 'form', schema: elicitation.request.schema }
                  : elicitation.request
              }
              locked={props.answering}
              onRespond={(answer) => props.onAnswer({ elicitation: answer })}
            />
          </div>
        ))
        .exhaustive()}
    </div>
  );
}

/** A card renders one update and delegates every action to its host. */
export function AgentUpdateCard(props: {
  update: AgentUpdate;
  answering: boolean;
  onAnswer: (answer: UpdateAnswer) => Promise<boolean>;
  /** Omitted where there is no composer to attach the update to. */
  onChatAbout?: () => void;
  onOpenSession: () => void;
}) {
  const request = () =>
    props.update.kind === 'interaction' ? props.update.request : undefined;
  return (
    <div class="min-w-0 p-3 text-sm text-ink">
      <div class="flex min-w-0 items-start gap-2">
        <span
          class="mt-1.5 size-2 shrink-0 rounded-full bg-warning"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <div class="font-semibold truncate">{props.update.sessionName}</div>
          <p class="text-ink-muted truncate">{props.update.summary}</p>
        </div>
        <span class="shrink-0 text-xs text-ink-extra-muted">
          {compactAge(props.update.updatedAt)}
        </span>
      </div>
      <Show when={request()}>
        {(value) => (
          <RequestActions
            request={value()}
            answering={props.answering}
            onAnswer={props.onAnswer}
          />
        )}
      </Show>
      <div class="mt-2 flex flex-wrap gap-1 pl-4">
        <Show when={props.onChatAbout}>
          {(onChatAbout) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="touch:min-h-11"
              onClick={() => onChatAbout()()}
            >
              Chat about this
            </Button>
          )}
        </Show>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="touch:min-h-11"
          onClick={props.onOpenSession}
        >
          Open session
        </Button>
      </div>
    </div>
  );
}
