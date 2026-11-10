import { t } from '@app/lib/i18n';
import type {
  EnrollSkip,
  Problem,
  SequenceErrorCode,
} from '@service-email/generated/schemas';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { isRetryable, type SequenceFailure } from '../core/errors';

function codeMessage(code: SequenceErrorCode) {
  return (
    match(code)
      .with('not_found', () => t('sequences.errorNotFound'))
      .with('invalid_sequence', () => t('sequences.errorInvalidSequence'))
      .with('invalid_request', () => t('sequences.errorInvalidRequest'))
      .with('action_unavailable', () => t('sequences.errorActionUnavailable'))
      .with('crm_unavailable', () => t('sequences.errorCrmUnavailable'))
      .with('internal', () => t('sequences.errorInternal'))
      // A code newer than this build still reads as a failure.
      .exhaustive(() => t('sequences.errorInternal'))
  );
}

function problemMessage(
  problem: Problem,
  position: number | undefined,
  tokens: string[] | undefined
) {
  return match(problem)
    .with('name_required', () => t('sequences.problemNameRequired'))
    .with('steps_required', () => t('sequences.problemStepsRequired'))
    .with('subject_required', () =>
      position === undefined
        ? t('sequences.errorInvalidSequence')
        : t('sequences.problemSubjectRequired', { position })
    )
    .with('body_required', () =>
      position === undefined
        ? t('sequences.errorInvalidSequence')
        : t('sequences.problemBodyRequired', { position })
    )
    .with('over_limit', () =>
      position === undefined
        ? t('sequences.problemOverLimit')
        : t('sequences.problemStepOverLimit', { position })
    )
    .with('unknown_token', () =>
      t('sequences.problemUnknownToken', { tokens: tokens?.join(', ') ?? '' })
    )
    .with('sender_unavailable', () => t('sequences.problemSenderUnavailable'))
    .exhaustive(() => t('sequences.errorInvalidSequence'));
}

/** A failed request, in the interface language. */
export function failureMessage(failure: SequenceFailure) {
  return match(failure)
    .with({ kind: 'unavailable' }, () => t('sequences.errorUnavailable'))
    .with({ kind: 'refused' }, ({ code, problem, position, tokens }) =>
      problem ? problemMessage(problem, position, tokens) : codeMessage(code)
    )
    .exhaustive();
}

export function skipMessage(skip: EnrollSkip) {
  return match(skip)
    .with('not_found', () => t('sequences.skipNotFound'))
    .with('no_email', () => t('sequences.skipNoEmail'))
    .with('unsubscribed', () => t('sequences.skipUnsubscribed'))
    .with('already_enrolled', () => t('sequences.skipAlreadyEnrolled'))
    .exhaustive(() => t('sequences.skipUnknown'));
}

/** A load that failed in place, with Retry when trying again can help. */
export function InlineFailure(props: {
  failure: SequenceFailure;
  onRetry: () => void;
}) {
  return (
    <div class="flex items-center gap-2 text-xs text-failure" role="alert">
      {failureMessage(props.failure)}
      <Show when={isRetryable(props.failure)}>
        <Button
          type="button"
          variant="link"
          size="xs"
          onClick={() => props.onRetry()}
        >
          {t('sequences.retry')}
        </Button>
      </Show>
    </div>
  );
}
