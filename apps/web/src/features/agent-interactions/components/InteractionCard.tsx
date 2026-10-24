import { fireAndForget } from '@core/util/fireAndForget';
import type { MessagePart } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  AgentInteraction,
  InteractionController,
} from '../context/interaction';
import { ApprovalCard } from './ApprovalCard';
import { DraftCard } from './DraftCard';
import { parseDraftedTool, type RespondToElicitation } from './LiveElicitation';
import { QuestionCard } from './QuestionCard';

type ToolPart = Extract<MessagePart, { kind: 'tool_use' }>;

/** How the step a request is about reads in the run: `Ran` · `rm -rf dist`. */
export type InteractionStep = { label: string; detail?: string | null };

/** The action an approval asks about, from the step's own wording if any. */
function approvalAction(step?: InteractionStep, tool?: ToolPart): string {
  if (tool?.detail.kind === 'terminal') return 'Run a command';
  if (step) return step.label;
  if (!tool) return 'Use a tool';
  return tool.name.kind === 'native' ? tool.name.name : tool.name.tool;
}

/** What the action acts on: the command, or the step's detail. */
function approvalDetail(
  step?: InteractionStep,
  tool?: ToolPart
): string | undefined {
  if (tool?.detail.kind === 'terminal') return tool.detail.command ?? undefined;
  return step?.detail ?? undefined;
}

/** The tool's raw input, for Show input, when it has one. */
function approvalInput(tool?: ToolPart): string | undefined {
  const detail = tool?.detail;
  if (detail?.kind !== 'macro' && detail?.kind !== 'other') return undefined;
  const input = detail.input;
  if (input === null || input === undefined) return undefined;
  return JSON.stringify(input, null, 2);
}

/**
 * A request the agent is waiting on, as the card it asks with: an approval
 * for an action, a draft to send, or a question to answer. Each has one
 * action that says yes, and a way to say no.
 *
 * What the user types into a question or a draft is kept with the
 * controller rather than the card, so a card that unmounts and comes back
 * while the request is open picks up where they left off.
 */
export function InteractionCard(props: {
  request: AgentInteraction;
  controller: InteractionController;
  tool?: ToolPart;
  /** The step the request is about, as the run words it. */
  step?: InteractionStep;
}) {
  const locked = () =>
    !props.controller.canAnswer() || props.controller.answering(props.request);
  // Read once: the card's own state carries every change after it mounts.
  const kept = props.controller.draft(props.request);
  return match(props.request)
    .with({ kind: 'permission' }, (request) => (
      <ApprovalCard
        action={approvalAction(props.step, props.tool)}
        detail={approvalDetail(props.step, props.tool)}
        input={approvalInput(props.tool)}
        options={request.options}
        canAnswer={props.controller.canAnswer()}
        answerers={props.controller.answerers}
        disabled={locked()}
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
    ))
    .with({ kind: 'elicitation' }, (request) => {
      // Keep the answer's typed shape intact; the controller checks liveness.
      const onRespond: RespondToElicitation = (answer) =>
        props.controller.respond({ ...request, answer });
      const question = (
        <QuestionCard
          message={request.message}
          request={
            request.request.kind === 'user_tool'
              ? { kind: 'form', schema: request.request.schema }
              : request.request
          }
          locked={locked()}
          canAnswer={props.controller.canAnswer()}
          answerers={props.controller.answerers}
          onRespond={onRespond}
          draft={{
            saved: kept?.form,
            save: (form) => props.controller.keepDraft(request, { form }),
          }}
        />
      );
      const userTool = request.request;
      if (userTool.kind !== 'user_tool') return question;
      const toolCall = request.toolCall ?? String(request.requestId);
      const draft = parseDraftedTool(userTool, toolCall);
      return (
        <Show when={draft} fallback={question}>
          {(tool) => (
            <DraftCard
              tool={tool()}
              toolCall={toolCall}
              message={request.message}
              review={{ canAnswer: () => !locked(), respond: onRespond }}
              canAnswer={props.controller.canAnswer()}
              answerers={props.controller.answerers}
              composes={props.controller.owns()}
              fallback={question}
              draft={{
                saved: kept?.tool,
                save: (edited) =>
                  props.controller.keepDraft(request, { tool: edited }),
              }}
            />
          )}
        </Show>
      );
    })
    .exhaustive();
}
