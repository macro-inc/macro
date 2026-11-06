import { handleAiUsageLimitError } from '@app/features/paywall/ai-usage-limit-handling';
import { isAiUsageLimitError } from '@app/lib/service-clients/ai-usage-limit';
import type { ResultError } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type {
  Draft,
  DraftContext,
  DraftedRoutine,
  DraftRequest,
} from '@service-scheduled-action/generated/schemas';
import type { ScheduleDraft } from '../core/draft';
import { createEmptyDraft } from '../core/routine-draft';
import { stepsFromTask } from '../core/routine-steps';
import { parseRoutineTriggers } from './routine-trigger-mapping';

/**
 * What the drafter may write. It finds the channels, people and other items
 * the description names itself, with the user's access.
 */
export type ComposerContext = {
  timezone: string;
  /** The model Ask AI steps it writes run on. */
  defaultModel: string;
  /** Whether triggers may ask AI before a run. */
  decisions: boolean;
  /** Whether AI may write code steps; otherwise it writes Ask AI steps. */
  codeSteps: boolean;
};

const COMPOSE_FAILED = 'Couldn’t draft that routine. Please try again.';
const TOO_LARGE =
  'That description is too long to draft. Shorten it and try again.';
const TIMED_OUT =
  'Drafting took too long. Try again, or describe the routine more simply.';

function draftContext(context: ComposerContext): DraftContext {
  return {
    timezone: context.timezone,
    agentModel: context.defaultModel,
    code: context.codeSteps,
    conditions: context.decisions,
  };
}

/** Why a draft request failed, for the dialog; `failure` when it's no known reason. */
function requestFailure(
  errors: ResultError<string>[],
  failure: string
): string {
  const usageLimit = errors.find(isAiUsageLimitError);
  if (usageLimit) return usageLimit.message;
  if (errors.some((error) => error.code === 'PAYLOAD_TOO_LARGE')) {
    return TOO_LARGE;
  }
  if (errors.some((error) => error.code === 'TIMEOUT')) return TIMED_OUT;
  return failure;
}

/**
 * Have the scheduler's AI draft what `draft` asks for: it writes the
 * routine or step, type-checks its code as saving would, and fixes what
 * fails. A string says why there's no draft. The span records how it
 * ended, never the request.
 */
export async function requestDraft(
  draft: DraftRequest,
  context: ComposerContext,
  failure: string
): Promise<Exclude<Draft, { outcome: 'failed' }> | string> {
  return await Telemetry.span('routine.draft', async (span) => {
    span.setAttr('routine.draft.kind', draft.type);
    const response = await scheduledActionClient.draftRoutine({
      draft,
      context: draftContext(context),
    });
    if (response.isErr()) {
      span.setAttr('routine.draft.outcome', 'request_failed');
      span.setAttr('routine.draft.error', response.error[0]?.code ?? 'unknown');
      span.error('Routine draft request failed');
      handleAiUsageLimitError(response.error);
      return requestFailure(response.error, failure);
    }
    span.setAttr('routine.draft.outcome', response.value.outcome);
    return response.value.outcome === 'failed'
      ? response.value.message
      : response.value;
  });
}

/** A drafted routine as an editable draft, or why it can't be one. */
export function draftFromRoutine(
  routine: DraftedRoutine,
  defaultModel: string
): ScheduleDraft | string {
  const steps = stepsFromTask({ steps: routine.steps });
  if (!steps) return 'The draft used steps Macro can’t run. Try rephrasing.';
  const drafted = steps.map((step, index) => {
    const problems = routine.problems.find(
      (item) => item.index === index
    )?.problems;
    return step.kind === 'code' && problems?.length
      ? { ...step, problems }
      : step;
  });
  const base = {
    ...createEmptyDraft(defaultModel),
    name: routine.name,
    triggers: (routine.trigger && parseRoutineTriggers(routine.trigger)) ?? [],
    enabled: true,
  };
  const [only] = drafted;
  // A single agent step stays the simple form, edited like any agent routine.
  return drafted.length === 1 && only?.kind === 'agent'
    ? { ...base, prompt: only.instructions, target: only.target }
    : { ...base, steps: drafted };
}

/** Draft a routine from a description; a string explains a failure. */
export async function composeRoutine(
  description: string,
  context: ComposerContext
): Promise<ScheduleDraft | string> {
  const drafted = await requestDraft(
    { type: 'routine', description },
    context,
    COMPOSE_FAILED
  );
  if (typeof drafted === 'string') return drafted;
  return drafted.outcome === 'routine'
    ? draftFromRoutine(drafted, context.defaultModel)
    : COMPOSE_FAILED;
}
