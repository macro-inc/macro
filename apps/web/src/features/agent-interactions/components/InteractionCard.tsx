import { fireAndForget } from '@core/util/fireAndForget';
import type { MessagePart } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  AgentInteraction,
  InteractionController,
} from '../context/interaction';
import { ElicitationCard, type ElicitationSummary } from './ElicitationCard';
import {
  composableDraft,
  type LiveQuestionRequest,
  QuestionCard,
  type RespondToElicitation,
  UserToolComposer,
} from './LiveElicitation';
import { PermissionCard } from './PermissionCard';

/**
 * Full live approvals and questions shared by conversation surfaces. Each
 * card is capped at a fixed height and scrolls inside, so a long form or a
 * draft under review never pushes the conversation off screen.
 */
export function InteractionCard(props: {
  request: AgentInteraction;
  controller: InteractionController;
  tool?: Extract<MessagePart, { kind: 'tool_use' }>;
  /** Who is asking, for a question's title. */
  agentName?: string;
}) {
  const locked = () =>
    !props.controller.canAnswer() || props.controller.answering(props.request);
  return match(props.request)
    .with({ kind: 'permission' }, (request) => (
      <div class="max-h-80 min-w-0 overflow-y-auto rounded-xl">
        <PermissionCard
          options={request.options}
          canAnswer={props.controller.canAnswer()}
          disabled={locked()}
          action={
            props.tool?.name.kind === 'native'
              ? props.tool.name.name
              : props.tool?.name.tool
          }
          detail={
            props.tool?.detail.kind === 'terminal'
              ? (props.tool.detail.command ?? undefined)
              : JSON.stringify(props.tool?.detail, null, 2)
          }
          onSelect={(optionId) =>
            fireAndForget(
              props.controller.respond({
                ...request,
                answer: { kind: 'selected', optionId },
              }),
              'agent-interactions'
            )
          }
        />
      </div>
    ))
    .with({ kind: 'elicitation' }, (request) => {
      // Keep the answer's typed shape intact; the controller checks liveness.
      const onRespond: RespondToElicitation = (answer) =>
        props.controller.respond({ ...request, answer });
      const summary = (): ElicitationSummary => ({
        title: `${props.agentName ?? 'The agent'} is asking`,
        status: props.controller.canAnswer() ? 'Waiting for you' : undefined,
        message: request.message,
        notice: props.controller.canAnswer()
          ? undefined
          : 'This agent is no longer available. You can still read the conversation.',
      });
      const asForm = (): LiveQuestionRequest =>
        request.request.kind === 'user_tool'
          ? { kind: 'form', schema: request.request.schema }
          : request.request;
      const toolCall = request.toolCall ?? String(request.requestId);
      const draft =
        request.request.kind === 'user_tool'
          ? composableDraft(request.request, toolCall)
          : undefined;
      return (
        <Show
          when={draft}
          fallback={
            <QuestionCard
              summary={summary()}
              class="max-h-80"
              request={asForm()}
              locked={locked()}
              onRespond={onRespond}
            />
          }
        >
          {(tool) => (
            <ElicitationCard summary={summary()} class="max-h-80">
              <UserToolComposer
                tool={tool()}
                toolCall={toolCall}
                cancel
                review={{ canAnswer: () => !locked(), respond: onRespond }}
              />
            </ElicitationCard>
          )}
        </Show>
      );
    })
    .exhaustive();
}
