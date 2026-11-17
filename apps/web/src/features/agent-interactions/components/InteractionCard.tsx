import { fireAndForget } from '@core/util/fireAndForget';
import type { MessagePart } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  AgentInteraction,
  InteractionController,
} from '../context/interaction';
import { LiveQuestionCard, type RespondToElicitation } from './LiveElicitation';
import { PermissionCard } from './PermissionCard';

/**
 * Full live approvals and questions shared by conversation surfaces. Each
 * card is capped at a fixed height and scrolls inside, so a long form never
 * pushes the conversation off screen. A user tool review from an older
 * session shows as the flat form the agent also sent.
 */
export function InteractionCard(props: {
  request: AgentInteraction;
  controller: InteractionController;
  tool?: Extract<MessagePart, { kind: 'tool_use' }>;
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
      return (
        <section
          aria-label="Agent question"
          class="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-edge-muted bg-panel p-4"
        >
          <p class="text-sm font-medium">{request.message}</p>
          <Show when={!props.controller.canAnswer()}>
            <p class="text-xs text-ink-muted">
              This agent is no longer available. You can still read the
              conversation.
            </p>
          </Show>
          <LiveQuestionCard
            request={
              request.request.kind === 'user_tool'
                ? { kind: 'form', schema: request.request.schema }
                : request.request
            }
            locked={locked()}
            onRespond={onRespond}
          />
        </section>
      );
    })
    .exhaustive();
}
