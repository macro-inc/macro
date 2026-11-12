import { handleAiUsageLimitError } from '@app/features/paywall/ai-usage-limit-handling';
import { isAiUsageLimitError } from '@app/lib/service-clients/ai-usage-limit';
import type { ResultError } from '@core/util/result';
import { sleep } from '@core/util/sleep';
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
import { stepsFromWire } from '../core/routine-steps';
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
  'This routine is too large for AI to draft. Shorten it and try again.';
const TIMED_OUT =
  'Drafting took too long. Try again, or describe the routine more simply.';
const CONNECTION_LOST =
  'Lost the connection while drafting. Check your connection and try again.';
/** How long to wait before sending a draft again after its request went unanswered. */
const RETRY_DELAY_MS = 1_000;

function draftContext(context: ComposerContext): DraftContext {
  return {
    timezone: context.timezone,
    agentModel: context.defaultModel,
    code: context.codeSteps,
    conditions: context.decisions,
  };
}

/**
 * Whether a request got no answer: its connection failed or dropped. Chrome
 * reports that as a network error; other browsers and the desktop app's
 * native transport as an unknown one.
 */
function unanswered(errors: ResultError<string>[]): boolean {
  return (
    errors.length > 0 &&
    errors.every(
      (error) =>
        error.code === 'NETWORK_ERROR' || error.code === 'UNKNOWN_ERROR'
    )
  );
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
  if (unanswered(errors)) return CONNECTION_LOST;
  return failure;
}

/**
 * Have the scheduler's AI draft what `draft` asks for: it writes the
 * routine or step, type-checks its code as saving would, and fixes what
 * fails. A string says why there's no draft. The span records how it
 * ended, never the request.
 *
 * A draft holds its request open until it's done. When the connection
 * drops first, the server stops that draft once it sees the drop, so it is
 * sent once more, unless `left` says nobody waits for it any more.
 */
export async function requestDraft(
  draft: DraftRequest,
  context: ComposerContext,
  failure: string,
  left?: AbortSignal
): Promise<Exclude<Draft, { outcome: 'failed' }> | string> {
  return await Telemetry.span('routine.draft', async (span) => {
    span.setAttr('routine.draft.kind', draft.type);
    const body = { draft, context: draftContext(context) };
    // Each attempt starts inside the span, so its request joins this trace.
    const send = () => span.run(() => scheduledActionClient.draftRoutine(body));
    let response = await send();
    let attempts = 1;
    if (response.isErr() && unanswered(response.error)) {
      await sleep(RETRY_DELAY_MS);
      // A draft nobody will open would still cost a session, so it isn't redone.
      if (!left?.aborted) {
        response = await send();
        attempts = 2;
      }
    }
    span.setAttr('routine.draft.attempts', attempts);
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
  const steps = stepsFromWire(routine.steps);
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
    created: routine.created,
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

/**
 * Draft a routine from a description; a string explains a failure. `left`
 * aborts once nobody waits for the draft.
 */
export async function composeRoutine(
  description: string,
  context: ComposerContext,
  left?: AbortSignal
): Promise<ScheduleDraft | string> {
  const drafted = await requestDraft(
    { type: 'routine', description },
    context,
    COMPOSE_FAILED,
    left
  );
  if (typeof drafted === 'string') return drafted;
  return drafted.outcome === 'routine'
    ? draftFromRoutine(drafted, context.defaultModel)
    : COMPOSE_FAILED;
}
