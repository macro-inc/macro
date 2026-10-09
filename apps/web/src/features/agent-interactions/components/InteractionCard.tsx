import type { MessagePart } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  AgentInteraction,
  InteractionController,
} from '../context/interaction';
import {
  LiveQuestionCard,
  parseDraftedTool,
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
            void props.controller.respond({
              ...request,
              answer: { kind: 'selected', optionId },
            })
          }
        />
      </div>
    ))
    .with({ kind: 'elicitation' }, (request) => {
      // Keep the answer's typed shape intact; the controller checks liveness.
      const onRespond: RespondToElicitation = (answer) =>
        props.controller.respond({ ...request, answer });
      const content = () => {
        if (request.request.kind !== 'user_tool')
          return (
            <LiveQuestionCard
              request={request.request}
              locked={locked()}
              onRespond={onRespond}
            />
          );
        const fallback = (
          <LiveQuestionCard
            request={{ kind: 'form', schema: request.request.schema }}
            locked={locked()}
            onRespond={onRespond}
          />
        );
        const toolCall = request.toolCall ?? String(request.requestId);
        const draft = parseDraftedTool(request.request, toolCall);
        return (
          <Show when={draft} fallback={fallback}>
            {(tool) => (
              <UserToolComposer
                tool={tool()}
                toolCall={toolCall}
                cancel
                fallback={fallback}
                review={{ canAnswer: () => !locked(), respond: onRespond }}
              />
            )}
          </Show>
        );
      };
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
          {content()}
        </section>
      );
    })
    .exhaustive();
}
