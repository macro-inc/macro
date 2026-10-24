import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from '@app/features/agent-cards/components/kit/card';
import { Tile } from '@app/features/agent-cards/components/kit/parts';
import { fireAndForget } from '@core/util/fireAndForget';
import QuestionIcon from '@phosphor/question.svg';
import type { ElicitationOption } from '@service-agent-fold/generated/types';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { DEFAULT_ANSWERERS, type DraftKeeper } from '../context/interaction';
import type { FormValues } from '../state/elicitation-form';
import {
  answerQuestion,
  createLiveQuestion,
  type LiveQuestionRequest,
  QuestionFields,
  type RespondToElicitation,
} from './LiveElicitation';

/** Longest option a quick answer puts on a button, in characters. */
const QUICK_LABEL_CHARS = 24;

/**
 * A question whose whole answer is one of two or three short options, with
 * no way to say something else: each option can be its own button.
 */
export function quickAnswers(
  request: LiveQuestionRequest
): { field: string; options: ElicitationOption[] } | undefined {
  if (request.kind !== 'form') return undefined;
  const [property, ...rest] = request.schema.properties;
  if (!property || rest.length > 0) return undefined;
  const field = property.schema;
  if (field.type !== 'string' || field.customField) return undefined;
  const { options } = field;
  if (options.length < 2 || options.length > 3) return undefined;
  const short = options.every(
    (option) => (option.title ?? option.value).length <= QUICK_LABEL_CHARS
  );
  return short ? { field: property.name, options } : undefined;
}

/**
 * A question the agent is waiting on, as one card: the question as its
 * title, then its options or fields, then Skip and the one action that
 * answers. A question of two or three short answers is answered by
 * pressing one. Anyone who cannot answer it sees the question and why.
 */
export function QuestionCard(props: {
  message: string;
  request: LiveQuestionRequest;
  /** An answer is on its way, or this viewer cannot answer. */
  locked: boolean;
  canAnswer: boolean;
  /** Who can, for a viewer who cannot: `someone who can edit this agent`. */
  answerers?: string;
  onRespond: RespondToElicitation;
  /** Where what the user types is kept, so it outlives the card. */
  draft?: DraftKeeper<FormValues>;
}) {
  // A request never changes, so its state is made once.
  const question = createLiveQuestion(props.request, props.draft);
  const quick = quickAnswers(props.request);
  const respond = (answer: ElicitationAnswer) => {
    if (!props.locked)
      fireAndForget(props.onRespond(answer), 'agent-interactions');
  };
  const answer = () => {
    if (!props.locked)
      fireAndForget(
        answerQuestion(question, props.onRespond),
        'agent-interactions'
      );
  };
  return (
    <Card width="standard" data-agent-card="question">
      <section aria-label="Agent question" class="flex min-h-0 flex-col">
        <CardHeader
          wrap
          padded={!!quick}
          tile={
            <Tile size={32} tone="accent">
              <QuestionIcon />
            </Tile>
          }
          title={props.message}
          subtitle={
            props.canAnswer
              ? undefined
              : `Only ${props.answerers ?? DEFAULT_ANSWERERS} can answer.`
          }
        />
        <Show when={!quick}>
          <CardBody class="max-h-64 overflow-y-auto">
            <QuestionFields question={question} locked={props.locked} asked />
          </CardBody>
        </Show>
        <Show when={props.canAnswer}>
          <CardFooter line={!!quick}>
            <Button
              size="sm"
              variant="ghost"
              class="mr-auto"
              disabled={props.locked}
              onClick={() => respond({ action: 'decline' })}
            >
              Skip
            </Button>
            <Show
              when={quick}
              fallback={
                <Show when={question.kind !== 'unrecognized'}>
                  <Button
                    size="sm"
                    variant="cta"
                    disabled={props.locked}
                    onClick={answer}
                  >
                    {question.kind === 'url' ? 'Open' : 'Submit'}
                  </Button>
                </Show>
              }
            >
              {(choices) => (
                <For each={choices().options}>
                  {(option) => (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={props.locked}
                      onClick={() =>
                        respond({
                          action: 'accept',
                          content: { [choices().field]: option.value },
                        })
                      }
                    >
                      {option.title ?? option.value}
                    </Button>
                  )}
                </For>
              )}
            </Show>
          </CardFooter>
        </Show>
      </section>
    </Card>
  );
}
