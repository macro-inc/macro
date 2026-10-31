/**
 * Feature errors carry a code, not text: views translate them, and the codes
 * stored on enrollment records stay readable in any interface language.
 */
export type MarketingErrorCode =
  | 'nameRequired'
  | 'senderRequired'
  | 'stepsRequired'
  | 'subjectSingleLine'
  | 'subjectRequired'
  | 'bodyRequired'
  | 'optOutRequired'
  | 'delayRange'
  | 'unknownPersonalization'
  | 'sequenceTooLong'
  | 'sequenceTooLarge'
  | 'invalidStartTime'
  | 'startTooSoon'
  | 'schedulingTooSlow'
  | 'inboxDisconnected'
  | 'inboxReauth'
  | 'inboxesLoading'
  | 'campaignInactive'
  | 'campaignChanged'
  | 'activateFirst'
  | 'invalidEmail'
  | 'alreadyEnrolled'
  | 'unsubscribed'
  | 'unreadableRecords'
  | 'enrollmentStopped'
  | 'enrollmentChanged'
  | 'enrollmentMissing'
  | 'notPaused'
  | 'nothingToResume'
  | 'scheduleFailed'
  | 'cancelFailed'
  | 'cancelKeepsChanging'
  | 'draftIdMissing'
  | 'columnMissing'
  | 'needEditAccess'
  | 'storageUnavailable'
  | 'changedElsewhere'
  | 'refreshFailed'
  | 'contactsFailed';

type MarketingErrorParams = Record<string, string | number>;

/** One contact's failure inside a batch action. */
export type ContactFailure = { email: string; error: unknown };

export class MarketingError extends Error {
  readonly code: MarketingErrorCode;
  readonly params: MarketingErrorParams;
  /** Per-contact causes, for `contactsFailed`. */
  readonly failures: ContactFailure[];
  constructor(
    code: MarketingErrorCode,
    params: MarketingErrorParams = {},
    failures: ContactFailure[] = []
  ) {
    super(code);
    this.name = 'MarketingError';
    this.code = code;
    this.params = params;
    this.failures = failures;
  }
}

/** Fail with every contact an action failed for, if any. */
export function throwContactFailures(failures: ContactFailure[]) {
  if (failures.length)
    throw new MarketingError(
      'contactsFailed',
      { count: failures.length },
      failures
    );
}

/** Codes an enrollment record may store as its `error`. */
export const ENROLLMENT_ERRORS = [
  'scheduleFailed',
  'cancelFailed',
  'inboxDisconnected',
] as const satisfies readonly MarketingErrorCode[];
export type EnrollmentErrorCode = (typeof ENROLLMENT_ERRORS)[number];
