import { t } from '@app/lib/i18n';
import type {
  EnrollSkip,
  Problem,
  SequenceErrorCode,
} from '@service-email/generated/schemas';
import { match } from 'ts-pattern';
import type { SequenceFailure } from '../core/errors';
import { SEQUENCE_LIMITS } from '../core/sequence';

function codeMessage(code: SequenceErrorCode) {
  return (
    match(code)
      .with('not_found', () => t('sequences.errorNotFound'))
      .with('version_conflict', () => t('sequences.errorVersionConflict'))
      .with('invalid_transition', () => t('sequences.errorInvalidTransition'))
      .with('invalid_sequence', () => t('sequences.errorInvalidSequence'))
      .with('sequence_not_active', () => t('sequences.errorSequenceNotActive'))
      .with('too_many_contacts', () =>
        t('sequences.errorTooManyContacts', { max: SEQUENCE_LIMITS.contacts })
      )
      .with('invalid_start', () => t('sequences.errorInvalidStart'))
      .with('invalid_timezone', () => t('sequences.errorInvalidTimezone'))
      .with('action_unavailable', () => t('sequences.errorActionUnavailable'))
      .with('step_in_delivery', () => t('sequences.errorStepInDelivery'))
      .with('step_taken_over', () => t('sequences.errorStepTakenOver'))
      .with('no_team', () => t('sequences.errorNoTeam'))
      .with('crm_disabled', () => t('sequences.errorCrmDisabled'))
      .with('internal', () => t('sequences.errorInternal'))
      // A code newer than this build still reads as a failure.
      .exhaustive(() => t('sequences.errorInternal'))
  );
}

/** A step problem names its email; without a position it reads generically. */
function problemMessage(
  problem: Problem,
  position: number | undefined,
  tokens: string[] | undefined
) {
  const step = (message: (position: number) => string) =>
    position === undefined
      ? t('sequences.errorInvalidSequence')
      : message(position);
  return match(problem)
    .with('name_required', () => t('sequences.problemNameRequired'))
    .with('name_too_long', () =>
      t('sequences.problemNameTooLong', { max: SEQUENCE_LIMITS.name })
    )
    .with('footer_too_long', () =>
      t('sequences.problemFooterTooLong', { max: SEQUENCE_LIMITS.footer })
    )
    .with('steps_required', () => t('sequences.problemStepsRequired'))
    .with('too_many_steps', () =>
      t('sequences.problemTooManySteps', { max: SEQUENCE_LIMITS.steps })
    )
    .with('first_step_is_reply', () => t('sequences.problemFirstStepIsReply'))
    .with('subject_required', () =>
      step((at) => t('sequences.problemSubjectRequired', { position: at }))
    )
    .with('subject_single_line', () =>
      step((at) => t('sequences.problemSubjectSingleLine', { position: at }))
    )
    .with('subject_too_long', () =>
      step((at) =>
        t('sequences.problemSubjectTooLong', {
          position: at,
          max: SEQUENCE_LIMITS.subject,
        })
      )
    )
    .with('body_required', () =>
      step((at) => t('sequences.problemBodyRequired', { position: at }))
    )
    .with('body_too_long', () =>
      step((at) =>
        t('sequences.problemBodyTooLong', {
          position: at,
          max: SEQUENCE_LIMITS.body,
        })
      )
    )
    .with('delay_range', () =>
      step((at) =>
        t('sequences.problemDelayRange', {
          position: at,
          max: SEQUENCE_LIMITS.delayDays,
        })
      )
    )
    .with('unknown_token', () =>
      t('sequences.problemUnknownToken', { tokens: tokens?.join(', ') ?? '' })
    )
    .with('sender_required', () => t('sequences.problemSenderRequired'))
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
    .with('invalid_email', () => t('sequences.skipInvalidEmail'))
    .with('unsubscribed', () => t('sequences.skipUnsubscribed'))
    .with('already_enrolled', () => t('sequences.skipAlreadyEnrolled'))
    .exhaustive(() => t('sequences.skipUnknown'));
}
